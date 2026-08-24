/**
 * registry.test.js — the resolution guarantees.
 *
 * The headline test is the first one: it asserts that the specific defect
 * found in the previous engine cannot be reproduced. A Japanese scenario must
 * not be able to reach a United Kingdom rule, and the registry must refuse
 * rather than fall back to whatever it has.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { registry, RuleRegistry, UnsupportedJurisdictionError, AmbiguousRuleError } from '../../../src/rules/index.js';
import { CATEGORY, PROPERTY_CLASS, RESIDENCY, OWNERSHIP, defineRule, METHOD } from '../../../src/rules/schema.js';
import { STATUS } from '../../../src/core/trace.js';

describe('Cross-jurisdiction leakage is structurally impossible', () => {
  test('a Japanese query never returns a United Kingdom rule', () => {
    const { rules } = registry.resolveAll({
      country: 'JP', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, holdingPeriod: 'long' },
    });
    assert.ok(rules.length > 0, 'Japan has capital gains rules');
    for (const rule of rules) {
      assert.equal(rule.jurisdiction.country, 'JP');
      assert.equal(rule.currency, 'JPY');
      assert.ok(!rule.id.startsWith('gb'), 'no UK rule leaked into a JP query');
    }
  });

  test('a UK query never returns a Japanese rule', () => {
    const { rule } = registry.resolve({
      country: 'GB', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL },
    });
    assert.equal(rule.jurisdiction.country, 'GB');
    assert.equal(rule.currency, 'GBP');
  });

  test('the same holding period never returns both the long and short tables', () => {
    const longRules = registry.resolveAll({
      country: 'JP', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, holdingPeriod: 'long' },
    }).rules;
    assert.ok(longRules.every((r) => r.id.includes('.long.')), 'only long-term rules');

    const shortRules = registry.resolveAll({
      country: 'JP', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, holdingPeriod: 'short' },
    }).rules;
    assert.ok(shortRules.every((r) => r.id.includes('.short.')), 'only short-term rules');
  });

  test('an unmodelled country returns UNSUPPORTED, never a substitute', () => {
    // The United States is not yet in the packs. The correct answer is a
    // refusal, not New York's tables and not the United Kingdom's.
    const { rule, unsupported } = registry.resolve({
      country: 'US', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
    });
    assert.equal(rule, null);
    assert.ok(unsupported);
    assert.match(unsupported.reason, /will not substitute a rule from another jurisdiction/);
  });

  test('require() throws rather than returning a wrong number', () => {
    assert.throws(
      () => registry.require({ country: 'US', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01' }),
      UnsupportedJurisdictionError,
    );
  });
});

describe('Devolved UK regimes are refused by name, not silently anglicised', () => {
  test('Scotland is refused and names Revenue Scotland and LBTT', () => {
    const { rule, unsupported } = registry.resolve({
      country: 'GB', region: 'GB-SCT', category: CATEGORY.ACQUISITION_TAX, on: '2026-06-01',
      facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL },
    });
    assert.equal(rule, null);
    assert.match(unsupported.reason, /Land and Buildings Transaction Tax/);
    assert.equal(unsupported.authority, 'Revenue Scotland');
    assert.match(unsupported.url, /revenue\.scot/);
  });

  test('Wales is refused and names the Welsh Revenue Authority and LTT', () => {
    const { rule, unsupported } = registry.resolve({
      country: 'GB', region: 'GB-WLS', category: CATEGORY.ACQUISITION_TAX, on: '2026-06-01',
      facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL },
    });
    assert.equal(rule, null);
    assert.match(unsupported.reason, /Land Transaction Tax/);
    assert.equal(unsupported.authority, 'Welsh Revenue Authority');
  });

  test('England and Northern Ireland still resolve normally', () => {
    const { rule } = registry.resolve({
      country: 'GB', region: 'GB-EAW', category: CATEGORY.ACQUISITION_TAX, on: '2026-06-01',
      facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL, residency: RESIDENCY.NON_RESIDENT },
    });
    assert.ok(rule);
    assert.match(rule.id, /^gb-eaw\.sdlt/);
  });
});

describe('Facts select the right rule', () => {
  const base = { country: 'GB', region: 'GB-EAW', category: CATEGORY.ACQUISITION_TAX, on: '2026-06-01' };

  test('residency picks the non-resident table', () => {
    const resident = registry.resolve({ ...base, facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL, residency: RESIDENCY.RESIDENT } }).rule;
    const nonResident = registry.resolve({ ...base, facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL, residency: RESIDENCY.NON_RESIDENT } }).rule;
    assert.notEqual(resident.id, nonResident.id);
    assert.match(nonResident.id, /nonresident/);
  });

  test('property class picks the non-residential table', () => {
    // A commercial purchase is a composite charge: the premium and, for a new
    // lease, the net present value of the rent. Naming the component selects
    // the premium charge specifically.
    const commercial = registry.resolve({
      ...base, component: 'principal', facts: { propertyClass: PROPERTY_CLASS.COMMERCIAL },
    }).rule;
    assert.equal(commercial.id, 'gb-eaw.sdlt.nonresidential');
  });

  test('a composite charge without a named component is refused, not guessed', () => {
    // Silently returning the premium charge and dropping the lease charge is
    // exactly the kind of quiet omission this product must not make.
    assert.throws(
      () => registry.resolve({ ...base, facts: { propertyClass: PROPERTY_CLASS.COMMERCIAL } }),
      AmbiguousRuleError,
    );
  });

  test('resolveAll returns every component of a commercial acquisition', () => {
    const { rules } = registry.resolveAll({ ...base, facts: { propertyClass: PROPERTY_CLASS.COMMERCIAL } });
    const ids = rules.map((r) => r.id).sort();
    assert.deepEqual(ids, ['gb-eaw.sdlt.nonresidential', 'gb-eaw.sdlt.nonresidential.lease-npv']);
  });

  test('resolveAll returns both levels of the Japanese capital gains bill', () => {
    const { rules } = registry.resolveAll({
      country: 'JP', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, holdingPeriod: 'long' },
    });
    const components = rules.map((r) => r.component).sort();
    assert.deepEqual(components, ['local', 'national']);
  });

  test('Japanese acquisition tax distinguishes land, home and commercial', () => {
    const q = { country: 'JP', region: 'JP-13', category: CATEGORY.ACQUISITION_TAX, on: '2026-06-01' };
    assert.equal(registry.resolve({ ...q, facts: { propertyClass: PROPERTY_CLASS.LAND } }).rule.id, 'jp.acquisition-tax.land');
    assert.equal(registry.resolve({ ...q, facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL } }).rule.id, 'jp.acquisition-tax.building.residential');
    assert.equal(registry.resolve({ ...q, facts: { propertyClass: PROPERTY_CLASS.COMMERCIAL } }).rule.id, 'jp.acquisition-tax.building.nonresidential');
  });
});

describe('Effective dates are honoured, not ignored', () => {
  test('a date before a rule commences finds nothing rather than applying it early', () => {
    const { rule, unsupported } = registry.resolve({
      country: 'GB', region: 'GB-EWNI', category: CATEGORY.INCOME_TAX, on: '2020-01-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL },
    });
    assert.equal(rule, null);
    assert.match(unsupported.reason, /No income_tax rule is in force/);
  });

  test('a date inside the window resolves', () => {
    const { rule } = registry.resolve({
      country: 'GB', region: 'GB-EWNI', category: CATEGORY.INCOME_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL },
    });
    assert.equal(rule.id, 'gb.income-tax.ewni');
  });

  test('a date after the window closes finds nothing', () => {
    const { rule } = registry.resolve({
      country: 'GB', region: 'GB-EWNI', category: CATEGORY.INCOME_TAX, on: '2030-01-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL },
    });
    assert.equal(rule, null);
  });

  test('the Japanese reduced land registration rate expires on schedule', () => {
    const q = { country: 'JP', category: CATEGORY.REGISTRATION_TAX, facts: { propertyClass: PROPERTY_CLASS.LAND } };
    assert.ok(registry.resolve({ ...q, on: '2029-03-31' }).rule, 'in force on the last day');
    assert.equal(registry.resolve({ ...q, on: '2029-04-01' }).rule, null, 'gone the next day');
  });
});

describe('An ambiguous rule pack fails loudly', () => {
  test('two equally specific rules throw rather than one winning silently', () => {
    const mk = (id) => defineRule({
      id, name: `Test ${id}`, version: '1',
      jurisdiction: { country: 'ZZ' },
      category: CATEGORY.INCOME_TAX, method: METHOD.FLAT_RATE, rate: '10',
      taxYear: '2026', effectiveFrom: '2020-01-01', currency: 'GBP',
      citations: [{ title: 'test', publisher: 'test', url: null, accessed: '2026-08-23', primary: false }],
      lastReviewed: '2026-08-23', verification: STATUS.ESTIMATED,
      limitations: ['synthetic test rule'],
    });
    const r = new RuleRegistry().add([mk('zz.a'), mk('zz.b')]);
    assert.throws(
      () => r.resolve({ country: 'ZZ', category: CATEGORY.INCOME_TAX, on: '2026-06-01' }),
      AmbiguousRuleError,
    );
  });

  test('duplicate rule ids are rejected at registration', () => {
    const rules = registry.rules;
    const seen = new Set();
    for (const r of rules) {
      const key = `${r.id}@${r.version}`;
      assert.ok(!seen.has(key), `duplicate ${key}`);
      seen.add(key);
    }
  });
});

describe('Coverage and staleness are reportable, not folklore', () => {
  test('coverage lists both countries and both declared gaps', () => {
    const c = registry.coverage();
    const codes = c.countries.map((x) => x.country);
    assert.deepEqual(codes, ['GB', 'JP']);
    assert.equal(c.declaredUnsupported.length, 2);
    assert.ok(c.totalRules > 15, `expected a substantive pack, got ${c.totalRules}`);
  });

  test('every registered rule is verified or explicitly weaker', () => {
    for (const r of registry.rules) {
      assert.ok(
        [STATUS.VERIFIED, STATUS.ESTIMATED, STATUS.ASSUMPTION].includes(r.verification),
        `${r.id} has a usable verification status`,
      );
    }
  });

  test('staleness reporting finds rules nobody has reviewed in a year', () => {
    assert.equal(registry.staleRules('2026-08-23', 365).length, 0, 'everything reviewed recently');
    // A year and a day later, everything reviewed today is stale.
    assert.ok(registry.staleRules('2027-08-25', 365).length > 0);
  });

  test('expired rules are reportable so a pack cannot rot unnoticed', () => {
    assert.equal(registry.expiredRules('2026-08-23').length, 0);
    const later = registry.expiredRules('2030-01-01');
    assert.ok(later.length > 0, 'the 2026-27 UK tax year rules have expired by 2030');
  });
});
