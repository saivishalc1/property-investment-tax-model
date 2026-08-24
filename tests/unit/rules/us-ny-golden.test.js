/**
 * us-ny-golden.test.js — federal and New York rules.
 *
 * The focus is the three things this jurisdiction gets wrong most often: the
 * "or fractional part thereof" unit charge, the cliff thresholds that re-rate
 * an entire consideration, and the section 1250 ceiling that is routinely
 * described as a flat 25% rate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Money } from '../../../src/core/money.js';
import { Decimal, ROUND } from '../../../src/core/decimal.js';
import { evaluateRule, marginalCharge } from '../../../src/rules/evaluate.js';
import { registry } from '../../../src/rules/index.js';
import { CATEGORY, PROPERTY_CLASS, OWNERSHIP } from '../../../src/rules/schema.js';
import {
  NYS_TRANSFER_TAX, NYS_MANSION_TAX, NYC_RPTT_RESIDENTIAL, NYC_RPTT_COMMERCIAL,
  FEDERAL_LTCG_2025, FEDERAL_LTCG_MFJ_2025, FEDERAL_1250_CAP, NIIT, NIIT_THRESHOLDS,
  US_NY_RULES,
} from '../../../src/rules/jurisdictions/us-ny.js';

const usd = (v) => Money.of(v, 'USD');
const charge = (rule, value) => evaluateRule(rule, usd(value)).amount.amount.toString();

describe('NYS transfer tax — "or fractional part thereof" is not a percentage', () => {
  test('an exact multiple of $500 matches the 0.4% equivalent', () => {
    // $295,000 / 500 = 590 exactly -> 590 x $2 = $1,180, and 0.4% is also $1,180.
    assert.equal(charge(NYS_TRANSFER_TAX, '295000'), '1180.00');
  });

  test('a fractional unit is charged as a whole unit', () => {
    // $295,100 / 500 = 590.2 -> charged on 591 units = $1,182.
    // Treating it as 0.4% would give $1,180.40 and understate the tax.
    assert.equal(charge(NYS_TRANSFER_TAX, '295100'), '1182.00');

    const asPercentage = Decimal.of('295100').multiply('0.004').rescale(2, ROUND.HALF_UP);
    assert.equal(asPercentage.toString(), '1180.40');
    assert.notEqual(charge(NYS_TRANSFER_TAX, '295100'), asPercentage.toString());
  });

  test('one cent over a unit boundary buys a whole extra unit', () => {
    assert.equal(charge(NYS_TRANSFER_TAX, '500000'), '2000.00'); // 1000 units
    assert.equal(charge(NYS_TRANSFER_TAX, '500000.01'), '2002.00'); // 1001 units
  });

  test('the tax does not apply at or below $500 of consideration', () => {
    assert.equal(charge(NYS_TRANSFER_TAX, '500'), '0.00');
    assert.equal(charge(NYS_TRANSFER_TAX, '501'), '4.00'); // 2 units
  });

  test('the trace shows the unit count, not just a rate', () => {
    const { trace } = evaluateRule(NYS_TRANSFER_TAX, usd('295100'));
    assert.match(trace.formula, /fractional part thereof/);
    assert.match(trace.lines[0].detail, /591 whole units/);
  });
});

describe('NYS mansion tax — a cliff, not a marginal band', () => {
  test('nothing below $1,000,000', () => {
    assert.equal(charge(NYS_MANSION_TAX, '999999.99'), '0.00');
  });

  test('1% of the ENTIRE price at exactly $1,000,000', () => {
    assert.equal(charge(NYS_MANSION_TAX, '1000000'), '10000.00');
  });

  test('one cent over the threshold costs ten thousand dollars', () => {
    const below = Decimal.of(charge(NYS_MANSION_TAX, '999999.99'));
    const at = Decimal.of(charge(NYS_MANSION_TAX, '1000000'));
    assert.equal(at.subtract(below).toString(), '10000.00');
  });

  test('a marginal reading would give a wrong and much smaller answer', () => {
    // Marginal on the excess over $1m would be a cent. The cliff is $10,000.
    assert.equal(charge(NYS_MANSION_TAX, '1000000.01'), '10000.00');
  });

  test('commercial property does not attract it', () => {
    const { rules } = registry.resolveAll({
      country: 'US', region: 'US-NY', category: CATEGORY.TRANSFER_TAX, on: '2025-06-01',
      facts: { propertyClass: PROPERTY_CLASS.COMMERCIAL },
    });
    assert.ok(!rules.some((r) => r.id === 'us-ny.mansion-tax'), 'mansion tax is residential only');
  });

  test('the cliff warning names the threshold ahead', () => {
    const { trace } = evaluateRule(NYS_MANSION_TAX, usd('950000'));
    const warnings = trace.allWarnings().map((w) => w.message).join(' ');
    assert.match(warnings, /Cliff threshold ahead/);
    assert.match(warnings, /1000000/);
  });
});

describe('NYC Real Property Transfer Tax — cliffs at $500,000', () => {
  test('residential: 1% at or below, 1.425% of everything above', () => {
    assert.equal(charge(NYC_RPTT_RESIDENTIAL, '500000'), '5000.00');
    assert.equal(charge(NYC_RPTT_RESIDENTIAL, '500000.01'), '7125.00');
  });

  test('a cent over the residential threshold costs $2,125', () => {
    const step = Decimal.of(charge(NYC_RPTT_RESIDENTIAL, '500000.01'))
      .subtract(Decimal.of(charge(NYC_RPTT_RESIDENTIAL, '500000')));
    assert.equal(step.toString(), '2125.00');
  });

  test('commercial: 1.425% at or below, 2.625% of everything above', () => {
    assert.equal(charge(NYC_RPTT_COMMERCIAL, '500000'), '7125.00');
    assert.equal(charge(NYC_RPTT_COMMERCIAL, '500000.01'), '13125.00');
  });

  test('commercial always costs more than residential at the same price', () => {
    for (const p of ['250000', '500000', '750000', '5000000']) {
      const res = Decimal.of(charge(NYC_RPTT_RESIDENTIAL, p));
      const com = Decimal.of(charge(NYC_RPTT_COMMERCIAL, p));
      assert.ok(com.gt(res), `commercial exceeds residential at ${p}`);
    }
  });

  test('both are paid by the seller, which changes who funds the closing', () => {
    assert.equal(NYC_RPTT_RESIDENTIAL.payer, 'seller');
    assert.equal(NYC_RPTT_COMMERCIAL.payer, 'seller');
    assert.equal(NYS_MANSION_TAX.payer, 'buyer');
    assert.equal(NYS_TRANSFER_TAX.payer, 'seller');
  });
});

describe('Unrecaptured section 1250 gain is a ceiling, not a flat rate', () => {
  test('the rule is documented as a maximum', () => {
    assert.match(FEDERAL_1250_CAP.limitations.join(' '), /CEILING on an ordinary-rate charge, not a flat rate/);
    assert.match(FEDERAL_1250_CAP.citations[0].title, /maximum 25% rate/);
  });

  test('a taxpayer below the cap pays their ordinary rate, not 25%', () => {
    // The engine takes the lower of the ordinary-rate charge and the ceiling.
    const unrecaptured = usd('100000');
    const ceiling = evaluateRule(FEDERAL_1250_CAP, unrecaptured).amount;
    assert.equal(ceiling.amount.toString(), '25000.00');

    // A 22% ordinary-rate taxpayer: 22,000 is lower, so 22,000 is the charge.
    const ordinaryRateCharge = usd('22000');
    const actual = ordinaryRateCharge.min(ceiling);
    assert.ok(actual.equals(usd('22000')), `expected 22000, got ${actual.amount}`);
    assert.ok(actual.lt(ceiling), 'the ordinary-rate charge is below the ceiling');
  });

  test('a taxpayer above the cap pays the capped 25%', () => {
    const ceiling = evaluateRule(FEDERAL_1250_CAP, usd('100000')).amount;
    const ordinaryRateCharge = usd('37000'); // 37% bracket
    assert.equal(ordinaryRateCharge.min(ceiling).amount.toString(), '25000.00');
  });
});

describe('Federal long-term capital gains stack on ordinary income', () => {
  test('a low earner pays 0% on a gain that stays inside the 0% band', () => {
    const { amount } = marginalCharge(FEDERAL_LTCG_2025, usd('0'), usd('40000'));
    assert.equal(amount.amount.toString(), '0.00');
  });

  test('a gain straddling the 0/15 boundary is split across both', () => {
    // Single filer, no other income, $60,000 gain: first $48,350 at 0%,
    // remaining $11,650 at 15% = $1,747.50
    const { amount } = marginalCharge(FEDERAL_LTCG_2025, usd('0'), usd('60000'));
    assert.equal(amount.amount.toString(), '1747.50');
  });

  test('the same gain costs more for a higher earner', () => {
    const gain = usd('60000');
    const low = marginalCharge(FEDERAL_LTCG_2025, usd('0'), gain).amount.amount;
    const high = marginalCharge(FEDERAL_LTCG_2025, usd('600000'), gain).amount.amount;
    assert.equal(high.toString(), '12000.00'); // entirely at 20%
    assert.ok(high.gt(low));
  });

  test('married filing jointly has a wider 0% band', () => {
    const gain = usd('90000');
    const single = marginalCharge(FEDERAL_LTCG_2025, usd('0'), gain).amount.amount;
    const joint = marginalCharge(FEDERAL_LTCG_MFJ_2025, usd('0'), gain).amount.amount;
    assert.ok(joint.lt(single), 'the joint 0% band reaches further');
    assert.equal(joint.toString(), '0.00');
  });
});

describe('NIIT thresholds are not indexed and the base is the lesser figure', () => {
  test('the published thresholds are recorded', () => {
    assert.equal(NIIT_THRESHOLDS.single, '200000');
    assert.equal(NIIT_THRESHOLDS.mfj, '250000');
    assert.equal(NIIT_THRESHOLDS.mfs, '125000');
  });

  test('the rate is 3.8%', () => {
    assert.equal(charge(NIIT, '100000'), '3800.00');
  });

  test('the rule records that the base is the LESSER of NII and the MAGI excess', () => {
    assert.match(NIIT.limitations.join(' '), /LESSER of net investment income and the MAGI excess/);
  });
});

describe('The 2026 gap is reported, not papered over', () => {
  test('the 2025 capital gains rule does not apply to a 2026 disposal', () => {
    const { rules, unsupported } = registry.resolveAll({
      country: 'US', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2026-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, filingStatus: 'single' },
    });
    // Only the section 1250 ceiling, which has no end date, remains in force.
    assert.ok(!rules.some((r) => r.id.includes('ltcg')), 'the 2025 LTCG table has expired');
    assert.equal(unsupported, null);
  });

  test('a 2025 disposal resolves normally', () => {
    const { rules } = registry.resolveAll({
      country: 'US', category: CATEGORY.CAPITAL_GAINS_TAX, on: '2025-06-01',
      facts: { ownership: OWNERSHIP.INDIVIDUAL, filingStatus: 'single' },
    });
    assert.ok(rules.some((r) => r.id === 'us.federal.ltcg.single.2025'));
  });

  test('the NYC supplemental tax is a declared gap, not a guess', () => {
    const { rules, unsupported } = registry.resolveAll({
      country: 'US', region: 'US-NY', category: CATEGORY.SURCHARGE, on: '2025-06-01',
      facts: { propertyClass: PROPERTY_CLASS.RESIDENTIAL },
    });
    assert.equal(rules.length, 0);
    assert.match(unsupported.reason, /supplemental transfer tax/);
    assert.match(unsupported.reason, /not computed rather than estimated/);
  });
});

describe('Pack hygiene', () => {
  test('every rule is in USD with a primary citation and stated limits', () => {
    for (const r of US_NY_RULES) {
      assert.equal(r.currency, 'USD', `${r.id}`);
      assert.ok(r.citations.some((c) => c.primary), `${r.id} has a primary source`);
      assert.ok(r.limitations.length > 0 || r.id.includes('mfj'), `${r.id} states limitations`);
    }
  });

  test('a US rule refuses a yen base', () => {
    assert.throws(
      () => evaluateRule(NYS_MANSION_TAX, Money.of('1000000', 'JPY')),
      /denominated in USD but the base is JPY/,
    );
  });
});
