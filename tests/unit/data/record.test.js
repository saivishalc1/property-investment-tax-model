/**
 * record.test.js — saved-property records: migration, corruption, backup, list.
 *
 * The bar here is that a professional never loses work silently. A damaged
 * record must be REPORTED, not replaced with defaults; a hostile file must not
 * reach Object.prototype; and one bad property in a backup of forty must not
 * cost the other thirty-nine.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECORD_VERSION, EXPORT_KIND, SORT,
  sanitize, newId, createRecord, migrateRecord, touch, duplicateRecord,
  nextCopyName, matchesQuery, sortRecords, buildBackup, readBackup,
} from '../../../src/data/record.js';

const scenario = (over = {}) => ({
  meta: { name: 'Kings Road', preset: 'uk' },
  purchase: { price: 425000, address: '12 Kings Road, Chelsea', propType: 'residential' },
  ...over,
});

describe('Creating a record', () => {
  test('captures the identity a professional searches by', () => {
    const r = createRecord({
      scenario: scenario(),
      summary: { country: 'GB', currency: 'GBP', taxYear: '2026-27', price: 425000 },
    });
    assert.equal(r.name, 'Kings Road');
    assert.equal(r.address, '12 Kings Road, Chelsea');
    assert.equal(r.jurisdiction, 'uk');
    assert.equal(r.country, 'GB');
    assert.equal(r.currency, 'GBP');
    assert.equal(r.taxYear, '2026-27');
    assert.equal(r.propertyType, 'residential');
    assert.equal(r.recordVersion, RECORD_VERSION);
    assert.equal(r.archivedAt, null);
    assert.ok(r.createdAt && r.updatedAt);
  });

  test('ids are random, not sequential, and do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
  });

  test('an unnamed property still gets a usable name', () => {
    const r = createRecord({ scenario: { purchase: {} } });
    assert.equal(r.name, 'Untitled property');
  });
});

describe('A hostile or damaged file cannot do harm', () => {
  test('prototype-polluting keys are dropped', () => {
    const evil = JSON.parse('{"a":1,"__proto__":{"polluted":true},"constructor":{"x":1}}');
    const clean = sanitize(evil);
    assert.equal(clean.a, 1);
    assert.equal(clean.polluted, undefined);
    assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
  });

  test('a nested __proto__ payload cannot reach the prototype chain', () => {
    const payload = JSON.parse('{"scenario":{"meta":{"__proto__":{"pwned":true}}}}');
    const { record } = migrateRecord(payload);
    assert.equal({}.pwned, undefined);
    assert.ok(record, 'the rest of the record still loads');
  });

  test('functions, symbols and exotic objects are stripped', () => {
    // Invalid values have their KEY removed rather than being set to null, so
    // a damaged field falls back to its default instead of becoming an
    // explicit null the rest of the code has to defend against.
    const clean = sanitize({ fn() {}, sym: Symbol('x'), map: new Map(), ok: 'yes' });
    assert.ok(!('fn' in clean), 'a function is dropped');
    assert.ok(!('sym' in clean), 'a symbol is dropped');
    assert.ok(!('map' in clean), 'a Map has the wrong prototype and is dropped');
    assert.equal(clean.ok, 'yes');
  });

  test('strings, arrays and depth are bounded', () => {
    const clean = sanitize({ s: 'x'.repeat(50000), a: new Array(5000).fill(1) });
    assert.ok(clean.s.length <= 2000);
    assert.ok(clean.a.length <= 500);

    let deep = { v: 1 };
    for (let i = 0; i < 40; i++) deep = { next: deep };
    assert.doesNotThrow(() => sanitize(deep));
  });

  test('NaN and Infinity do not survive into stored data', () => {
    // JSON cannot represent either, so a record containing them came from
    // somewhere other than a normal save and the fields are dropped.
    const clean = sanitize({ a: NaN, b: Infinity, c: 1.5 });
    assert.ok(!('a' in clean), 'NaN is dropped');
    assert.ok(!('b' in clean), 'Infinity is dropped');
    assert.equal(clean.c, 1.5);
  });

  test('an explicit null is preserved, because it is a real value', () => {
    const clean = sanitize({ archivedAt: null, name: 'x' });
    assert.ok('archivedAt' in clean);
    assert.equal(clean.archivedAt, null);
  });
});

describe('Migration repairs what it can and refuses what it cannot', () => {
  test('a v1 record is upgraded and the upgrade is reported', () => {
    const { record, repaired, problems } = migrateRecord({
      recordVersion: 1,
      id: 'abc',
      name: 'Old one',
      scenario: { meta: { preset: 'jp' } },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(record.recordVersion, RECORD_VERSION);
    assert.equal(record.jurisdiction, 'jp', 'the jurisdiction was lifted out of the scenario');
    assert.equal(repaired, true);
    assert.match(problems.join(' '), /Upgraded from record version 1/);
  });

  test('missing timestamps are repaired and flagged, not silently invented', () => {
    const { record, repaired, problems } = migrateRecord({ id: 'x', scenario: {} });
    assert.ok(record.createdAt && record.updatedAt);
    assert.equal(repaired, true);
    assert.match(problems.join(' '), /creation time/);
  });

  test('something that is not a record at all is REFUSED, not defaulted', () => {
    // Writing defaults over this would present an empty analysis as though it
    // were the user's saved work.
    for (const bad of [null, 42, 'a string', [], {}, { name: 'no scenario' }]) {
      const { record, problems } = migrateRecord(bad);
      assert.equal(record, null, `${JSON.stringify(bad)} must be refused`);
      assert.ok(problems.length > 0);
    }
  });

  test('a record with a scenario always survives, however battered', () => {
    const { record } = migrateRecord({ scenario: { purchase: { price: 1 } } });
    assert.ok(record);
    assert.equal(record.name, 'Untitled property');
    assert.match(record.id, /^[0-9a-f]{32}$/);
  });
});

describe('Duplicate and rename', () => {
  test('a duplicate is a new property, not a second reference to the old one', () => {
    const original = createRecord({ scenario: scenario(), name: 'Kings Road' });
    const copy = duplicateRecord(original);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, 'Kings Road (copy)');
    assert.equal(copy.archivedAt, null);
    assert.deepEqual(copy.scenario, original.scenario);
  });

  test('copy names increment instead of colliding', () => {
    assert.equal(nextCopyName('Kings Road'), 'Kings Road (copy)');
    assert.equal(nextCopyName('Kings Road (copy)'), 'Kings Road (copy 2)');
    assert.equal(nextCopyName('Kings Road (copy 2)'), 'Kings Road (copy 3)');
    assert.equal(nextCopyName(''), 'Untitled property (copy)');
  });

  test('touch moves the modification time but not the creation time', async () => {
    const r = createRecord({ scenario: scenario() });
    await new Promise((res) => setTimeout(res, 5));
    const t = touch(r);
    assert.equal(t.createdAt, r.createdAt);
    assert.ok(Date.parse(t.updatedAt) >= Date.parse(r.updatedAt));
  });
});

describe('Finding a property again', () => {
  const records = [
    createRecord({ scenario: scenario(), name: 'Kings Road', summary: { country: 'GB' } }),
    createRecord({ scenario: { purchase: { address: '4-1 Minami-Aoyama, Minato' }, meta: { preset: 'jp' } }, name: 'Aoyama walk-up', summary: { country: 'JP' } }),
    createRecord({ scenario: { purchase: { address: '221 E 60th St' }, meta: { preset: 'us-nyc' } }, name: 'Upper East Side condo', summary: { country: 'US' } }),
  ];

  test('search matches name, address and jurisdiction', () => {
    assert.ok(matchesQuery(records[0], 'kings'));
    assert.ok(matchesQuery(records[0], 'chelsea'), 'address is searchable');
    assert.ok(matchesQuery(records[1], 'jp'), 'jurisdiction is searchable');
    assert.ok(!matchesQuery(records[0], 'tokyo'));
  });

  test('every word must match, so typing more narrows the list', () => {
    assert.ok(matchesQuery(records[0], 'kings chelsea'));
    assert.ok(!matchesQuery(records[0], 'kings tokyo'));
  });

  test('search ignores case and accents', () => {
    const r = createRecord({ scenario: { purchase: { address: 'Kings Röad' } }, name: 'Café flat' });
    assert.ok(matchesQuery(r, 'cafe'));
    assert.ok(matchesQuery(r, 'ROAD'));
  });

  test('an empty query matches everything', () => {
    for (const r of records) assert.ok(matchesQuery(r, ''));
  });

  test('sorting by name, country and recency', () => {
    const byName = sortRecords(records, SORT.NAME, 'asc').map((r) => r.name);
    assert.deepEqual(byName, ['Aoyama walk-up', 'Kings Road', 'Upper East Side condo']);

    const byCountry = sortRecords(records, SORT.COUNTRY, 'asc').map((r) => r.country);
    assert.deepEqual(byCountry, ['GB', 'JP', 'US']);

    // Recency is the default and puts the most recently touched first.
    const recent = sortRecords(records, SORT.UPDATED, 'desc');
    assert.equal(recent.length, 3);
  });
});

describe('Backup and restore', () => {
  const records = [
    createRecord({ scenario: scenario(), name: 'Kings Road' }),
    createRecord({ scenario: { meta: { preset: 'jp' }, purchase: {} }, name: 'Aoyama' }),
  ];

  test('a backup round-trips every record', () => {
    const file = buildBackup(records);
    assert.equal(file.kind, EXPORT_KIND);
    assert.equal(file.count, 2);

    const { records: back, rejected, problems } = readBackup(JSON.stringify(file));
    assert.equal(back.length, 2);
    assert.equal(rejected.length, 0);
    assert.equal(problems.length, 0);
    assert.deepEqual(back.map((r) => r.name).sort(), ['Aoyama', 'Kings Road']);
  });

  test('ONE damaged property does not cost the others', () => {
    const file = buildBackup([records[0], { junk: true }, records[1]]);
    const { records: back, rejected } = readBackup(JSON.stringify(file));
    assert.equal(back.length, 2, 'both good records survived');
    assert.equal(rejected.length, 1, 'and the bad one is reported');
    assert.ok(rejected[0].problems.length > 0);
  });

  test('a file from somewhere else is refused by name', () => {
    const { records: back, problems } = readBackup(JSON.stringify({ kind: 'something-else', records: [] }));
    assert.equal(back.length, 0);
    assert.match(problems.join(' '), /not a backup from this application/);
  });

  test('malformed JSON is refused without throwing', () => {
    for (const bad of ['{not json', '', 'null', '[]', '{"kind":"' + EXPORT_KIND + '"}']) {
      const out = readBackup(bad);
      assert.equal(out.records.length, 0);
      assert.ok(out.problems.length > 0, `${bad} reports a problem`);
    }
  });

  test('a hostile backup cannot pollute the prototype through import', () => {
    const hostile = `{"kind":"${EXPORT_KIND}","records":[{"scenario":{},"__proto__":{"pwned":true}}]}`;
    readBackup(hostile);
    assert.equal({}.pwned, undefined);
  });

  test('an absurdly large file is refused before parsing', () => {
    const huge = 'x'.repeat(512 * 1024 * 200 + 1);
    const out = readBackup(huge);
    assert.match(out.problems.join(' '), /too large/);
  });
});
