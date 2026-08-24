/**
 * jp-golden.test.js — the Japan pack against the National Tax Agency's own
 * worked examples, plus an independent cross-check of the income tax.
 *
 * The income tax check is deliberately NOT a re-run of our band loop. The NTA
 * publishes a 速算表 (quick calculation table) that computes the same tax by a
 * completely different method — one multiplication and one subtraction of a
 * published deduction constant. Our progressive-slice engine and that formula
 * are independent implementations, so agreement across the whole range is real
 * evidence rather than a tautology.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Money } from '../../../src/core/money.js';
import { Decimal, ROUND } from '../../../src/core/decimal.js';
import { evaluateRule } from '../../../src/rules/evaluate.js';
import {
  CGT_LONG_NATIONAL, CGT_LONG_LOCAL, CGT_SHORT_NATIONAL, CGT_SHORT_LOCAL,
  RECONSTRUCTION_SURTAX, INCOME_TAX,
  ACQUISITION_TAX_LAND, ACQUISITION_TAX_BUILDING_NONRESIDENTIAL,
  REGISTRATION_TAX_LAND_SALE,
  jpHoldingPeriodIsLongTerm, usedBuildingUsefulLife, USEFUL_LIVES, JP_RULES,
} from '../../../src/rules/jurisdictions/jp.js';

const jpy = (v) => Money.of(v, 'JPY');
const charge = (rule, value) => evaluateRule(rule, jpy(value)).amount.amount.toString();

describe('Japan capital gains — NTA worked examples', () => {
  test('No.3208 long-term: a 40,000,000 yen gain', () => {
    // Source: https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm
    //   sale 145,000,000 - (cost 100,000,000 + expenses 5,000,000) = 40,000,000
    //   income tax   40,000,000 x 15%  = 6,000,000
    //   surtax        6,000,000 x 2.1% =   126,000
    //   inhabitant   40,000,000 x  5%  = 2,000,000
    const gain = jpy('145000000').subtract(jpy('100000000')).subtract(jpy('5000000'));
    assert.equal(gain.amount.toString(), '40000000');

    const national = evaluateRule(CGT_LONG_NATIONAL, gain).amount;
    const surtax = evaluateRule(RECONSTRUCTION_SURTAX, national).amount;
    const local = evaluateRule(CGT_LONG_LOCAL, gain).amount;

    assert.equal(national.amount.toString(), '6000000');
    assert.equal(surtax.amount.toString(), '126000');
    assert.equal(local.amount.toString(), '2000000');

    const total = national.add(surtax).add(local);
    assert.equal(total.amount.toString(), '8126000');
  });

  test('No.3211 short-term: an 8,000,000 yen gain', () => {
    // Source: https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm
    //   income tax    8,000,000 x 30%  = 2,400,000
    //   surtax        2,400,000 x 2.1% =    50,400
    //   inhabitant    8,000,000 x  9%  =   720,000
    const gain = jpy('8000000');
    const national = evaluateRule(CGT_SHORT_NATIONAL, gain).amount;
    const surtax = evaluateRule(RECONSTRUCTION_SURTAX, national).amount;
    const local = evaluateRule(CGT_SHORT_LOCAL, gain).amount;

    assert.equal(national.amount.toString(), '2400000');
    assert.equal(surtax.amount.toString(), '50400');
    assert.equal(local.amount.toString(), '720000');
    assert.equal(national.add(surtax).add(local).amount.toString(), '3170400');
  });

  test('the combined rates reproduce the published 20.315% and 39.63%', () => {
    const gain = jpy('100000000');
    const long = evaluateRule(CGT_LONG_NATIONAL, gain).amount;
    const longTotal = long
      .add(evaluateRule(RECONSTRUCTION_SURTAX, long).amount)
      .add(evaluateRule(CGT_LONG_LOCAL, gain).amount);
    assert.equal(longTotal.ratioTo(gain, 5, ROUND.HALF_UP).multiply(100).toString(), '20.31500');

    const short = evaluateRule(CGT_SHORT_NATIONAL, gain).amount;
    const shortTotal = short
      .add(evaluateRule(RECONSTRUCTION_SURTAX, short).amount)
      .add(evaluateRule(CGT_SHORT_LOCAL, gain).amount);
    assert.equal(shortTotal.ratioTo(gain, 5, ROUND.HALF_UP).multiply(100).toString(), '39.63000');
  });

  test('the surtax is 2.1% of the tax, not of the gain', () => {
    // Getting this wrong overstates the surtax roughly sevenfold on a
    // long-term disposal, which is why it has its own test.
    const gain = jpy('40000000');
    const national = evaluateRule(CGT_LONG_NATIONAL, gain).amount;
    const surtax = evaluateRule(RECONSTRUCTION_SURTAX, national).amount;
    assert.equal(surtax.amount.toString(), '126000');
    assert.notEqual(surtax.amount.toString(), '840000'); // 2.1% of the gain
  });

  test('the taxable base is taken down to the whole 1,000 yen', () => {
    // 40,000,999 -> 40,000,000 before the rate is applied.
    assert.equal(charge(CGT_LONG_NATIONAL, '40000999'), '6000000');
    assert.equal(charge(CGT_LONG_NATIONAL, '40001000'), '6000150');
  });
});

describe('Japan five-year test — measured at 1 January of the year of sale', () => {
  test('more than five calendar years held can still be SHORT term', () => {
    // Bought June 2020, sold July 2025: five years and one month by the
    // calendar, but only four full years as at 1 January 2025.
    const r = jpHoldingPeriodIsLongTerm('2020-06-15', '2025-07-01');
    assert.equal(r.longTerm, false);
    assert.equal(r.referenceDate, '2025-01-01');
    assert.equal(r.yearsAtReference, 4);
    assert.match(r.explanation, /short term/);
  });

  test('exactly five years at the reference date is short term, not long', () => {
    // The statute says "exceeding five years" for long term and "five years or
    // less" for short, so five exactly falls on the short side.
    const r = jpHoldingPeriodIsLongTerm('2019-06-15', '2025-07-01');
    assert.equal(r.yearsAtReference, 5);
    assert.equal(r.longTerm, false);
  });

  test('six years at the reference date is long term', () => {
    const r = jpHoldingPeriodIsLongTerm('2018-06-15', '2025-07-01');
    assert.equal(r.yearsAtReference, 6);
    assert.equal(r.longTerm, true);
  });

  test('a 1 January acquisition counts the full year', () => {
    assert.equal(jpHoldingPeriodIsLongTerm('2020-01-01', '2026-01-01').yearsAtReference, 6);
    // One day later loses a whole year at the reference date.
    assert.equal(jpHoldingPeriodIsLongTerm('2020-01-02', '2026-01-01').yearsAtReference, 5);
  });

  test('the 19-point consequence of the rule is real money', () => {
    const gain = jpy('30000000');
    const shortR = jpHoldingPeriodIsLongTerm('2020-06-15', '2025-07-01');
    assert.equal(shortR.longTerm, false);

    const shortNat = evaluateRule(CGT_SHORT_NATIONAL, gain).amount;
    const shortTotal = shortNat
      .add(evaluateRule(RECONSTRUCTION_SURTAX, shortNat).amount)
      .add(evaluateRule(CGT_SHORT_LOCAL, gain).amount);

    const longNat = evaluateRule(CGT_LONG_NATIONAL, gain).amount;
    const longTotal = longNat
      .add(evaluateRule(RECONSTRUCTION_SURTAX, longNat).amount)
      .add(evaluateRule(CGT_LONG_LOCAL, gain).amount);

    // Selling six months later, in the following calendar year, would flip it.
    assert.equal(shortTotal.subtract(longTotal).amount.toString(), '5794500');
  });

  test('invalid dates are rejected rather than guessed at', () => {
    assert.throws(() => jpHoldingPeriodIsLongTerm('2020', '2025-07-01'), /ISO/);
    assert.throws(() => jpHoldingPeriodIsLongTerm('2025-07-01', '2020-06-15'), /precedes/);
  });
});

describe('Japan income tax — cross-checked against the NTA 速算表', () => {
  /**
   * The NTA's published quick-calculation table: tax = income x rate - deduction.
   * A different algorithm from our band loop, using constants published by the
   * NTA rather than derived by us.
   * Source: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm
   */
  const QUICK = [
    { upTo: 1949000, rate: '5', deduct: '0' },
    { upTo: 3299000, rate: '10', deduct: '97500' },
    { upTo: 6949000, rate: '20', deduct: '427500' },
    { upTo: 8999000, rate: '23', deduct: '636000' },
    { upTo: 17999000, rate: '33', deduct: '1536000' },
    { upTo: 39999000, rate: '40', deduct: '2796000' },
    { upTo: Infinity, rate: '45', deduct: '4796000' },
  ];

  function quickTableTax(income) {
    const band = QUICK.find((b) => income <= b.upTo);
    const d = Decimal.of(String(income));
    return d.multiply(band.rate).divide(100, 0, ROUND.DOWN).subtract(Decimal.of(band.deduct));
  }

  test('agrees with the quick table at every band boundary and midpoint', () => {
    const probes = [
      1000, 1000000, 1949000, 1950000, 2000000, 3299000, 3300000, 5000000,
      6949000, 6950000, 8000000, 8999000, 9000000, 12000000, 17999000,
      18000000, 30000000, 39999000, 40000000, 60000000,
    ];
    for (const income of probes) {
      const ours = evaluateRule(INCOME_TAX, jpy(String(income))).amount.amount;
      const theirs = quickTableTax(income);
      assert.equal(
        ours.toString(), theirs.toString(),
        `income ${income}: engine ${ours} vs NTA quick table ${theirs}`,
      );
    }
  });

  test('a spot value matches the published arithmetic exactly', () => {
    // 5,000,000 x 20% - 427,500 = 572,500
    assert.equal(charge(INCOME_TAX, '5000000'), '572500');
  });

  test('taxable income is taken down to the whole 1,000 yen first', () => {
    assert.equal(charge(INCOME_TAX, '5000999'), '572500');
  });
});

describe('Japan acquisition-stage taxes', () => {
  test('non-residential buildings pay 4%, land and homes pay 3%', () => {
    assert.equal(charge(ACQUISITION_TAX_LAND, '50000000'), '1500000');
    assert.equal(charge(ACQUISITION_TAX_BUILDING_NONRESIDENTIAL, '50000000'), '2000000');
  });

  test('the 免税点 suppresses the charge entirely below the threshold', () => {
    assert.equal(charge(ACQUISITION_TAX_LAND, '99999'), '0');
    assert.equal(charge(ACQUISITION_TAX_LAND, '100000'), '3000');
  });

  test('registration tax on land is the reduced 1.5% and floors to 100 yen', () => {
    assert.equal(charge(REGISTRATION_TAX_LAND_SALE, '10000000'), '150000');
    // 3,333,333 x 1.5% = 49,999.995 -> floored to the whole 100 yen
    assert.equal(charge(REGISTRATION_TAX_LAND_SALE, '3333333'), '49900');
  });
});

describe('Japan depreciation — structure, use and age', () => {
  test('statutory lives match the NTA table, not a single flattened figure', () => {
    assert.equal(USEFUL_LIVES.reinforcedConcrete.residential, 47);
    assert.equal(USEFUL_LIVES.reinforcedConcrete.office, 50);
    assert.equal(USEFUL_LIVES.wood.residential, 22);
    assert.equal(USEFUL_LIVES.wood.office, 24);
    assert.equal(USEFUL_LIVES.steelOver4mm.residential, 34);
    assert.equal(USEFUL_LIVES.steel3to4mm.residential, 27);
    assert.equal(USEFUL_LIVES.steelUnder3mm.residential, 19);
    assert.equal(USEFUL_LIVES.brickStoneBlock.residential, 38);
    assert.equal(USEFUL_LIVES.woodMortar.residential, 20);
  });

  test('a wooden block depreciates in less than half the time of concrete', () => {
    assert.ok(USEFUL_LIVES.wood.residential * 2 < USEFUL_LIVES.reinforcedConcrete.residential);
  });

  test('second-hand life: fully elapsed gives 20% of the statutory life', () => {
    // 30-year-old wooden house, statutory 22, fully elapsed -> 22 x 20% = 4.4 -> 4
    assert.equal(usedBuildingUsefulLife(22, 30), 4);
    // 60-year-old concrete, statutory 47 -> 9.4 -> 9
    assert.equal(usedBuildingUsefulLife(47, 60), 9);
  });

  test('second-hand life: partly elapsed uses remaining + 20% of elapsed', () => {
    // 10-year-old concrete: (47 - 10) + 10 x 20% = 39
    assert.equal(usedBuildingUsefulLife(47, 10), 39);
    // 10-year-old wooden: (22 - 10) + 2 = 14
    assert.equal(usedBuildingUsefulLife(22, 10), 14);
  });

  test('second-hand life never falls below the statutory floor of two years', () => {
    assert.equal(usedBuildingUsefulLife(5, 40), 2);
  });

  test('a brand new building keeps its full statutory life', () => {
    assert.equal(usedBuildingUsefulLife(47, 0), 47);
    assert.equal(usedBuildingUsefulLife(22, 0), 22);
  });
});

describe('Japan pack provenance and currency', () => {
  test('every rule is denominated in JPY and carries a primary citation', () => {
    for (const rule of JP_RULES) {
      assert.equal(rule.currency, 'JPY', `${rule.id} is in yen`);
      assert.ok(rule.citations.some((c) => c.primary), `${rule.id} has a primary source`);
      assert.ok(rule.limitations.length > 0, `${rule.id} declares limitations`);
    }
  });

  test('yen amounts never acquire a fractional part', () => {
    for (const v of ['12345678', '999', '40000999']) {
      const out = evaluateRule(CGT_LONG_NATIONAL, jpy(v)).amount;
      assert.ok(!out.amount.toString().includes('.'), `${v} produced a fractional yen`);
    }
  });

  test('a yen rule refuses a pound base', () => {
    assert.throws(
      () => evaluateRule(CGT_LONG_NATIONAL, Money.of('40000000', 'GBP')),
      /denominated in JPY but the base is GBP/,
    );
  });
});
