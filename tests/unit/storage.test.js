import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, nycExampleState, migrate, sanitize, normaliseTable,
  saveAutosave, loadAutosave, clearAutosave, listScenarios, saveScenario,
  deleteScenario, duplicateScenario, loadPrefs, savePrefs, SCHEMA_VERSION,
} from '../../src/storage.js';
import { computeModel } from '../../src/calculations.js';

/* A minimal localStorage stand-in so persistence can be tested under Node. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();

test('the default scenario carries the current schema version and computes', () => {
  const s = defaultState();
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.ok(s.meta.id);
  assert.ok(Number.isFinite(computeModel(s).returns.totalProfit));
});

test('the NYC example is a real, computable scenario', () => {
  const s = nycExampleState();
  assert.equal(s.hold.years, 10);
  assert.equal(s.purchase.price, 1250000);
  const r = computeModel(s);
  assert.ok(r.purchase.mansionTax > 0);
  assert.ok(Number.isFinite(r.returns.roi));
});

/* ---------------- sanitisation ---------------- */

test('sanitize strips prototype-polluting keys', () => {
  const hostile = JSON.parse('{"a":1,"__proto__":{"polluted":true},"constructor":{"x":1}}');
  const clean = sanitize(hostile);
  assert.equal(clean.a, 1);
  assert.equal(clean.polluted, undefined);
  assert.equal(({}).polluted, undefined, 'Object.prototype must be untouched');
  assert.ok(!Object.prototype.hasOwnProperty.call(clean, '__proto__'));
});

test('a nested __proto__ payload cannot reach Object.prototype through migrate', () => {
  const hostile = JSON.parse('{"purchase":{"__proto__":{"pwned":"yes"},"price":500000}}');
  const s = migrate(hostile);
  assert.equal(s.purchase.price, 500000);
  assert.equal(({}).pwned, undefined);
  assert.equal(([]).pwned, undefined);
});

test('sanitize drops functions, symbols and exotic objects', () => {
  const clean = sanitize({ fn: () => 1, when: new Date(), re: /x/, ok: 'yes', n: 5, b: true });
  assert.equal(clean.ok, 'yes');
  assert.equal(clean.n, 5);
  assert.equal(clean.b, true);
  assert.equal(clean.fn, undefined);
  assert.equal(clean.when, null);
  assert.equal(clean.re, null);
});

test('sanitize bounds strings, arrays and depth', () => {
  assert.equal(sanitize('x'.repeat(5000)).length, 2000);
  assert.equal(sanitize(new Array(2000).fill(1)).length, 500);
  let deep = { v: 1 };
  for (let i = 0; i < 40; i++) deep = { child: deep };
  assert.doesNotThrow(() => sanitize(deep));
});

test('sanitize turns NaN and Infinity into zero', () => {
  assert.equal(sanitize({ a: NaN }).a, 0);
  assert.equal(sanitize({ a: Infinity }).a, 0);
});

/* ---------------- migration ---------------- */

test('a version 1 scenario migrates to the current schema', () => {
  const v1 = {
    meta: { name: 'Old file', preset: 'us-nyc', mode: 'quick' },
    purchase: { price: 800000, downPct: 25, buyerPaysTransferTax: true },
    hold: { years: 6, rentMo: 5000, depMonthsY1: 6 },
    sale: { sellerPaysTransferTax: true },
    rates: { fedOrdinary: 35 },
  };
  const s = migrate(v1);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.purchase.price, 800000);
  assert.equal(s.hold.years, 6);
  assert.equal(s.rates.fedOrdinary, 35);
  // depMonthsY1 = 6 means six months of depreciation, i.e. placed in service in month 7.
  assert.equal(s.profile.serviceMonth, 7);
  // the old boolean pair becomes an explicit payer on each side
  assert.equal(s.purchase.transferTaxPayer, 'buyer');
  assert.equal(s.sale.transferTaxPayer, 'seller');
  // v1/v2 spread improvement spend evenly, so that behaviour is preserved
  assert.equal(s.hold.capexTiming, 'spread');
  assert.ok(Number.isFinite(computeModel(s).returns.roi));
});

test('a version 2 scenario keeps its transfer-tax payer settings', () => {
  const v2 = {
    schemaVersion: 2,
    purchase: { price: 700000, buyerPaysTransferTax: false },
    sale: { sellerPaysTransferTax: false },
  };
  const s = migrate(v2);
  assert.equal(s.purchase.transferTaxPayer, 'seller');
  assert.equal(s.sale.transferTaxPayer, 'buyer');
});

test('migration drops unknown keys and repairs bad ones', () => {
  const s = migrate({
    schemaVersion: 3,
    meta: { preset: 'not-a-real-preset', mode: 'hacker', name: 'X' },
    purchase: { price: 500000, evil: 'payload' },
    rates: { stateTransferRes: 'not an array', nonsense: 1 },
  });
  assert.equal(s.meta.preset, 'us-nyc', 'an unknown preset falls back to New York City');
  assert.equal(s.meta.mode, 'quick', 'an unknown mode falls back to quick');
  assert.equal(s.purchase.evil, undefined);
  assert.equal(s.rates.nonsense, undefined);
  assert.deepEqual(s.rates.stateTransferRes, []);
});

test('bracket tables are coerced to numbers and sorted', () => {
  const t = normaliseTable([{ min: '500000', rate: '1.925' }, { min: 0, rate: 1.8 }, null, 'junk']);
  assert.deepEqual(t, [{ min: 0, rate: 1.8 }, { min: 500000, rate: 1.925 }]);
});

test('garbage input migrates to null rather than throwing', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate('a string'), null);
  assert.equal(migrate(42), null);
  assert.ok(migrate({}), 'an empty object becomes a default scenario');
});

/* ---------------- persistence ---------------- */

test('autosave round-trips through storage', () => {
  localStorage.clear();
  const s = defaultState();
  s.meta.name = 'Autosaved';
  s.purchase.price = 1234567;
  assert.ok(saveAutosave(s));
  const back = loadAutosave();
  assert.equal(back.meta.name, 'Autosaved');
  assert.equal(back.purchase.price, 1234567);
  clearAutosave();
  assert.equal(loadAutosave(), null);
});

test('a legacy autosave key is picked up and migrated', () => {
  localStorage.clear();
  localStorage.setItem('pitm.autosave.v1', JSON.stringify({
    purchase: { price: 640000 }, hold: { years: 4, depMonthsY1: 12 },
  }));
  const back = loadAutosave();
  assert.equal(back.purchase.price, 640000);
  assert.equal(back.schemaVersion, SCHEMA_VERSION);
  assert.equal(back.profile.serviceMonth, 1);
});

test('corrupt stored JSON does not throw', () => {
  localStorage.clear();
  localStorage.setItem('pitm.autosave.v3', '{not json');
  assert.equal(loadAutosave(), null);
});

test('scenarios save, list, update in place, duplicate and delete', () => {
  localStorage.clear();
  const a = defaultState();
  a.meta.name = 'Brooklyn duplex';
  saveScenario(a);
  const b = defaultState();
  b.meta.name = 'Queens condo';
  saveScenario(b);

  let all = listScenarios();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((s) => s.meta.name).sort(), ['Brooklyn duplex', 'Queens condo']);

  a.purchase.price = 999999;
  saveScenario(a);
  all = listScenarios();
  assert.equal(all.length, 2, 'saving the same id updates rather than appends');
  assert.equal(all.find((s) => s.meta.id === a.meta.id).purchase.price, 999999);

  const copy = duplicateScenario(a);
  assert.notEqual(copy.meta.id, a.meta.id);
  assert.match(copy.meta.name, /\(copy\)$/);
  saveScenario(copy);
  assert.equal(listScenarios().length, 3);

  deleteScenario(a.meta.id);
  const names = listScenarios().map((s) => s.meta.name);
  assert.ok(!names.includes('Brooklyn duplex'));
  assert.equal(listScenarios().length, 2);
});

test('preferences persist independently of scenarios', () => {
  localStorage.clear();
  savePrefs({ theme: 'dark' });
  assert.equal(loadPrefs().theme, 'dark');
  assert.deepEqual(loadPrefs({}).theme, 'dark');
});

test('storage failures degrade gracefully instead of throwing', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveAutosave(defaultState()), false);
  assert.equal(loadAutosave(), null);
  assert.deepEqual(listScenarios(), []);
  assert.deepEqual(loadPrefs(), {});
  globalThis.localStorage = original;
});
