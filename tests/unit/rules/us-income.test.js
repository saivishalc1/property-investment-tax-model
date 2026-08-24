/**
 * us-income.test.js — the federal, state and city ordinary schedules.
 *
 * These rules drive every United States rental income figure and the section
 * 1250 recapture, and the coverage report found that none of them had a test
 * naming it. That is exactly the gap the report exists to surface.
 *
 * The federal expectations are INDEPENDENTLY DERIVED: the cumulative tax at the
 * top of each bracket is computed by hand below from the published band widths,
 * not by running the engine and recording what it said. A test that records the
 * implementation's own answer proves only that the implementation is
 * deterministic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Money } from '../../../src/core/money.js';
import { Decimal } from '../../../src/core/decimal.js';
import { evaluateRule, marginalCharge } from '../../../src/rules/evaluate.js';
import {
  FEDERAL_ORDINARY_SINGLE, FEDERAL_ORDINARY_MFJ,
  NY_STATE_SINGLE, NY_STATE_MFJ,
  NYC_INCOME_SINGLE, NYC_INCOME_MFJ,
  FEDERAL_LTCG_SINGLE_2026, FEDERAL_LTCG_MFJ_2026,
  NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL,
} from '../../../src/rules/jurisdictions/us-ny.js';

const usd = (v) => Money.of(v, 'USD');
const charge = (rule, v) => evaluateRule(rule, usd(v)).amount.amount.toString();

describe('Federal ordinary brackets — single filer', () => {
  /*
   * Cumulative tax at the top of each band, worked by hand from the published
   * thresholds (IRS 2026 inflation adjustments, Rev. Proc. 2025-32):
   *
   *   10% x  12,400                      =   1,240.00   cum   1,240.00
   *   12% x ( 50,400 -  12,400) = 38,000 =   4,560.00   cum   5,800.00
   *   22% x (105,700 -  50,400) = 55,300 =  12,166.00   cum  17,966.00
   *   24% x (201,775 - 105,700) = 96,075 =  23,058.00   cum  41,024.00
   *   32% x (256,225 - 201,775) = 54,450 =  17,424.00   cum  58,448.00
   *   35% x (640,600 - 256,225) = 384,375 = 134,531.25  cum 192,979.25
   */
  const CUMULATIVE = [
    ['12400', '1240.00'],
    ['50400', '5800.00'],
    ['105700', '17966.00'],
    ['201775', '41024.00'],
    ['256225', '58448.00'],
    ['640600', '192979.25'],
  ];

  test('the cumulative tax at every band top matches the hand calculation', () => {
    for (const [income, expected] of CUMULATIVE) {
      assert.equal(charge(FEDERAL_ORDINARY_SINGLE, income), expected, `at ${income}`);
    }
  });

  test('immediately below, exactly at, and immediately above every threshold', () => {
    const thresholds = ['12400', '50400', '105700', '201775', '256225', '640600'];
    const rateAbove = { 12400: 12, 50400: 22, 105700: 24, 201775: 32, 256225: 35, 640600: 37 };

    for (const t of thresholds) {
      const at = Decimal.of(charge(FEDERAL_ORDINARY_SINGLE, t));
      const below = Decimal.of(charge(FEDERAL_ORDINARY_SINGLE, String(Number(t) - 1)));
      const above = Decimal.of(charge(FEDERAL_ORDINARY_SINGLE, String(Number(t) + 1)));

      // A marginal schedule has no cliff: one dollar costs one dollar's rate.
      const stepUp = above.subtract(at).multiply(100).rescale(0, 'HALF_UP');
      assert.equal(stepUp.toString(), String(rateAbove[t]), `one dollar above ${t}`);
      assert.ok(below.lt(at), `below ${t} is less than at ${t}`);
    }
  });

  test('zero and negative income produce no tax rather than NaN', () => {
    assert.equal(charge(FEDERAL_ORDINARY_SINGLE, '0'), '0.00');
    const { amount } = marginalCharge(FEDERAL_ORDINARY_SINGLE, usd('0'), usd('-5000'));
    assert.ok(!amount.isPositive(), 'a loss never produces a positive charge');
  });

  test('the top rate applies only above the top threshold', () => {
    // $1,000,000: 192,979.25 + 37% of (1,000,000 - 640,600) = 192,979.25 + 132,978
    assert.equal(charge(FEDERAL_ORDINARY_SINGLE, '1000000'), '325957.25');
  });
});

describe('Federal ordinary brackets — married filing jointly', () => {
  /*
   *   10% x  24,800                       =   2,480.00  cum   2,480.00
   *   12% x (100,800 -  24,800) =  76,000 =   9,120.00  cum  11,600.00
   *   22% x (211,400 - 100,800) = 110,600 =  24,332.00  cum  35,932.00
   *   24% x (403,550 - 211,400) = 192,150 =  46,116.00  cum  82,048.00
   *   32% x (512,450 - 403,550) = 108,900 =  34,848.00  cum 116,896.00
   *   35% x (768,700 - 512,450) = 256,250 =  89,687.50  cum 206,583.50
   */
  test('the cumulative tax at every band top matches the hand calculation', () => {
    for (const [income, expected] of [
      ['24800', '2480.00'], ['100800', '11600.00'], ['211400', '35932.00'],
      ['403550', '82048.00'], ['512450', '116896.00'], ['768700', '206583.50'],
    ]) {
      assert.equal(charge(FEDERAL_ORDINARY_MFJ, income), expected, `at ${income}`);
    }
  });

  test('a joint filer pays less than a single filer on the same income', () => {
    for (const income of ['50000', '150000', '400000', '700000']) {
      const single = Decimal.of(charge(FEDERAL_ORDINARY_SINGLE, income));
      const joint = Decimal.of(charge(FEDERAL_ORDINARY_MFJ, income));
      assert.ok(joint.lt(single), `joint pays less at ${income}`);
    }
  });

  test('the joint bands are twice the single bands up to the 35% step', () => {
    // Verifiable structure: 24,800 = 2 x 12,400; 100,800 = 2 x 50,400.
    assert.equal(charge(FEDERAL_ORDINARY_MFJ, '24800'),
      Decimal.of(charge(FEDERAL_ORDINARY_SINGLE, '12400')).multiply(2).toString());
  });
});

describe('New York State — secondary-sourced, and marked so', () => {
  test('the schedule is estimated, not verified', () => {
    for (const r of [NY_STATE_SINGLE, NY_STATE_MFJ]) {
      assert.equal(r.verification, 'estimated');
      assert.ok(!r.citations.some((c) => c.primary), 'no primary source is claimed');
      assert.match(r.limitations.join(' '), /NOT confirmed against a primary source/);
    }
  });

  test('every band boundary behaves marginally', () => {
    const thresholds = ['8500', '11700', '13900', '80650', '215400', '1077550'];
    for (const t of thresholds) {
      const at = Decimal.of(charge(NY_STATE_SINGLE, t));
      const above = Decimal.of(charge(NY_STATE_SINGLE, String(Number(t) + 1000)));
      assert.ok(above.gt(at), `above ${t} exceeds at ${t}`);
      // No cliff: 1,000 more dollars never costs more than 1,000 x the top rate.
      assert.ok(above.subtract(at).lt(Decimal.of('109')), `no cliff at ${t}`);
    }
  });

  test('the first band is 3.9% and applies from the first dollar', () => {
    assert.equal(charge(NY_STATE_SINGLE, '8500'), '331.50'); // 8,500 x 3.9%
  });

  test('New York taxes a gain as ordinary income, with no preferential rate', () => {
    assert.match(NY_STATE_SINGLE.limitations.join(' '), /does not tax capital gains at a preferential rate/i);
  });
});

describe('New York City resident tax', () => {
  test('the schedule is estimated and says the Department memo is obsolete', () => {
    for (const r of [NYC_INCOME_SINGLE, NYC_INCOME_MFJ]) {
      assert.equal(r.verification, 'estimated');
      assert.match(r.limitations.join(' '), /obsolete/);
      assert.match(r.limitations.join(' '), /only to a New York City resident/);
    }
  });

  test('above the top threshold the rate is effectively a flat 3.876%', () => {
    // 3.876% of an extra 100,000 at high income.
    const a = Decimal.of(charge(NYC_INCOME_SINGLE, '200000'));
    const b = Decimal.of(charge(NYC_INCOME_SINGLE, '300000'));
    assert.equal(b.subtract(a).toString(), '3876.00');
  });

  test('the lowest band is 3.078%', () => {
    assert.equal(charge(NYC_INCOME_SINGLE, '12000'), '369.36'); // 12,000 x 3.078%
  });
});

describe('The 2026 capital gains tables are carried forward, and labelled', () => {
  test('both filing statuses are estimated with the uncertainty stated', () => {
    for (const r of [FEDERAL_LTCG_SINGLE_2026, FEDERAL_LTCG_MFJ_2026]) {
      assert.equal(r.verification, 'estimated');
      assert.equal(r.taxYear, '2026');
      assert.match(r.limitations.join(' '), /THESE ARE THE 2025 BREAKPOINTS/);
    }
  });

  test('the joint 0% band reaches twice as far as the single one', () => {
    const gain = usd('90000');
    const single = marginalCharge(FEDERAL_LTCG_SINGLE_2026, usd('0'), gain).amount.amount;
    const joint = marginalCharge(FEDERAL_LTCG_MFJ_2026, usd('0'), gain).amount.amount;
    assert.equal(joint.toString(), '0.00', 'entirely inside the joint 0% band');
    assert.ok(single.gt(joint));
  });

  test('a joint gain crossing into the 15% band', () => {
    // 0% to 96,700, then 15%. A 150,000 gain with no other income:
    // 15% x (150,000 - 96,700) = 7,995.
    const { amount } = marginalCharge(FEDERAL_LTCG_MFJ_2026, usd('0'), usd('150000'));
    assert.equal(amount.amount.toString(), '7995.00');
  });
});

describe('NYS additional base tax on high-value New York City residences', () => {
  test('nothing below $3,000,000', () => {
    assert.equal(charge(NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL, '2999999'), '0.00');
  });

  test('at $3,000,000 it is $1.25 for each $500', () => {
    // 3,000,000 / 500 = 6,000 units x $1.25 = $7,500.
    assert.equal(charge(NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL, '3000000'), '7500.00');
  });

  test('the fractional-part rule applies here too', () => {
    // 3,000,100 / 500 = 6,000.2 -> 6,001 units x $1.25 = $7,501.25
    assert.equal(charge(NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL, '3000100'), '7501.25');
  });

  test('it is a seller charge, and residential only', () => {
    assert.equal(NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL.payer, 'seller');
    assert.deepEqual([...NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL.applicability.propertyClass], ['residential']);
  });
});
