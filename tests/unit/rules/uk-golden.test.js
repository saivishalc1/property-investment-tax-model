/**
 * uk-golden.test.js — the United Kingdom pack against HMRC's own worked examples.
 *
 * These are GOLDEN CASES. Every expected figure below is published by HMRC on
 * gov.uk, not derived from our own implementation, so the test cannot pass by
 * agreeing with a bug. Each case names the page it came from.
 *
 * Alongside them are threshold tests placed immediately below, exactly at, and
 * immediately above every band boundary — because a band table is only as good
 * as its edges, and an off-by-one-penny error in a cliff or slice boundary is
 * invisible in a mid-band spot check.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Money } from '../../../src/core/money.js';
import { Decimal } from '../../../src/core/decimal.js';
import { evaluateRule, marginalCharge } from '../../../src/rules/evaluate.js';
import {
  SDLT_RESIDENTIAL_STANDARD,
  SDLT_RESIDENTIAL_ADDITIONAL,
  SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT,
  SDLT_NON_RESIDENTIAL,
  CGT_RESIDENTIAL,
  UK_CONSTANTS,
} from '../../../src/rules/jurisdictions/uk.js';

const gbp = (v) => Money.of(v, 'GBP');
const charge = (rule, value) => evaluateRule(rule, gbp(value)).amount.amount.toString();

describe('UK SDLT — residential, sole property (HMRC worked example)', () => {
  test('£295,000 produces £4,750 exactly as HMRC publishes', () => {
    // Source: https://www.gov.uk/stamp-duty-land-tax/residential-property-rates
    //   0% on the first £125,000     = £0
    //   2% on the second £125,000    = £2,500
    //   5% on the final £45,000      = £2,250
    //   total                        = £4,750
    const { amount, trace } = evaluateRule(SDLT_RESIDENTIAL_STANDARD, gbp('295000'));
    assert.equal(amount.amount.toString(), '4750');

    // The trace must show the same three bands the published example does,
    // including the nil-rate band — a reader checking the workings needs to
    // see the £0 line, not have it quietly omitted.
    // Line amounts carry full working precision; the display layer quantises.
    // Compare by value, not by string, or the test asserts on formatting.
    assert.equal(trace.lines.length, 3, 'all three bands appear in the workings');
    assert.ok(trace.lines[0].amount.isZero(), '0% on the first £125,000');
    assert.ok(trace.lines[1].amount.equals(gbp('2500')), '2% on the second £125,000');
    assert.ok(trace.lines[2].amount.equals(gbp('2250')), '5% on the final £45,000');
  });

  test('every band boundary: below, at, and above', () => {
    // At exactly the threshold the higher band has not yet started, because
    // the bands are expressed as "the portion from £125,001".
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '125000'), '0');
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '125001'), '0'); // 2% of £1 rounds down to £0
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '125100'), '2'); // 2% of £100
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '250000'), '2500'); // full 2% band
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '250100'), '2505'); // +5% of £100
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '925000'), '36250'); // 2500 + 5% of 675k
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '1500000'), '93750'); // + 10% of 575k
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '1500100'), '93762'); // + 12% of £100
  });

  test('zero and sub-threshold prices produce no charge, not NaN', () => {
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '0'), '0');
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '1'), '0');
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '124999'), '0');
  });

  test('a penny either side of a threshold does not flip the band', () => {
    // Exactness matters here: in float arithmetic 250000.01 - 250000 is not
    // exactly 0.01, and a slice computed from it drifts.
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '249999.99'), '2499');
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '250000.01'), '2500');
  });
});

describe('UK SDLT — additional property (higher rates)', () => {
  test('surcharge is +5 points on every band, including the nil band', () => {
    // £295,000: 5% on 125k = 6,250; 7% on 125k = 8,750; 10% on 45k = 4,500.
    assert.equal(charge(SDLT_RESIDENTIAL_ADDITIONAL, '295000'), '19500');
  });

  test('the nil-rate band is no longer nil for an additional property', () => {
    assert.equal(charge(SDLT_RESIDENTIAL_ADDITIONAL, '100000'), '5000'); // 5% of 100k
    assert.equal(charge(SDLT_RESIDENTIAL_STANDARD, '100000'), '0');
  });

  test('non-resident additional buyer pays a further 2 points', () => {
    // 7% on 125k = 8,750; 9% on 125k = 11,250; 12% on 45k = 5,400.
    assert.equal(charge(SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT, '295000'), '25400');
  });

  test('the three residential tables differ by exactly the stated surcharges', () => {
    const price = gbp('600000');
    const standard = evaluateRule(SDLT_RESIDENTIAL_STANDARD, price).amount.amount;
    const additional = evaluateRule(SDLT_RESIDENTIAL_ADDITIONAL, price).amount.amount;
    const nonResident = evaluateRule(SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT, price).amount.amount;

    // A flat surcharge on every band is arithmetically a flat % of the price.
    assert.equal(additional.subtract(standard).toString(), '30000'); // 5% of 600k
    assert.equal(nonResident.subtract(additional).toString(), '12000'); // 2% of 600k
  });
});

describe('UK SDLT — non-residential (HMRC worked example)', () => {
  test('£275,000 commercial produces £3,250 exactly as HMRC publishes', () => {
    // Source: https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates
    //   0% on the first £150,000 = £0
    //   2% on the next £100,000  = £2,000
    //   5% on the final £25,000  = £1,250
    //   total                    = £3,250
    assert.equal(charge(SDLT_NON_RESIDENTIAL, '275000'), '3250');
  });

  test('non-residential boundaries', () => {
    assert.equal(charge(SDLT_NON_RESIDENTIAL, '150000'), '0');
    assert.equal(charge(SDLT_NON_RESIDENTIAL, '250000'), '2000');
    assert.equal(charge(SDLT_NON_RESIDENTIAL, '250100'), '2005');
  });

  test('commercial property carries no additional-dwelling surcharge', () => {
    // The whole point of the separate table: a company buying a shop does not
    // pay the second-home surcharge that a buy-to-let flat attracts.
    assert.equal(charge(SDLT_NON_RESIDENTIAL, '295000'), '4250');
    assert.notEqual(charge(SDLT_NON_RESIDENTIAL, '295000'), charge(SDLT_RESIDENTIAL_ADDITIONAL, '295000'));
  });
});

describe('UK Capital Gains Tax (HMRC worked examples)', () => {
  const AEA = Decimal.of(UK_CONSTANTS.cgtAnnualExemptAmount);

  test('annual exempt amount is the published £3,000', () => {
    assert.equal(AEA.toString(), '3000');
  });

  test('example 1 — gain inside the basic rate band gives £1,728', () => {
    // Source: https://www.gov.uk/capital-gains-tax/rates, Example 1.
    //   taxable income £20,000; taxable gains £12,600; less £3,000 AEA = £9,600
    //   £20,000 + £9,600 = £29,600 < £37,700, so all at 18% = £1,728
    const taxableGain = gbp('12600').subtract(gbp(AEA));
    assert.equal(taxableGain.amount.toString(), '9600');

    const { amount } = marginalCharge(CGT_RESIDENTIAL, gbp('20000'), taxableGain);
    assert.equal(amount.amount.toString(), '1728.00');
  });

  test('example 2 — gain straddling the band boundary gives £10,842', () => {
    // Source: https://www.gov.uk/capital-gains-tax/rates, Example 2.
    //   taxable income £20,000; taxable gains £52,600; less £3,000 AEA = £49,600
    //   £17,700 of basic band remains -> 18%; the other £31,900 -> 24%
    //   £3,186 + £7,656 = £10,842
    const taxableGain = gbp('52600').subtract(gbp(AEA));
    assert.equal(taxableGain.amount.toString(), '49600');

    const { amount, trace } = marginalCharge(CGT_RESIDENTIAL, gbp('20000'), taxableGain);
    assert.equal(amount.amount.toString(), '10842.00');

    // The stacking must be visible in the trace, not just correct by accident.
    assert.equal(trace.children.length, 2, 'trace shows tax with and without the gain');
    assert.ok(trace.formula.includes('tax(base + amount) - tax(base)'));
  });

  test('the rate depends on the taxpayer, which is the whole point of stacking', () => {
    const gain = gbp('20000');
    const lowEarner = marginalCharge(CGT_RESIDENTIAL, gbp('0'), gain).amount.amount;
    const highEarner = marginalCharge(CGT_RESIDENTIAL, gbp('100000'), gain).amount.amount;

    assert.equal(lowEarner.toString(), '3600.00'); // entirely at 18%
    assert.equal(highEarner.toString(), '4800.00'); // entirely at 24%
    assert.ok(highEarner.gt(lowEarner), 'a higher-rate taxpayer pays more on the same gain');
  });

  test('a gain landing exactly on the band boundary', () => {
    // Income £0, gain £37,700 -> exactly fills the basic band at 18%.
    const atBoundary = marginalCharge(CGT_RESIDENTIAL, gbp('0'), gbp('37700')).amount.amount;
    assert.equal(atBoundary.toString(), '6786.00');

    // One pound more is taxed at 24%.
    const justOver = marginalCharge(CGT_RESIDENTIAL, gbp('0'), gbp('37701')).amount.amount;
    assert.equal(justOver.subtract(atBoundary).toString(), '0.24');
  });

  test('a loss produces a negative charge, i.e. relief, not a positive tax', () => {
    const { amount } = marginalCharge(CGT_RESIDENTIAL, gbp('50000'), gbp('-10000'));
    assert.ok(amount.isNegative(), 'a reduction in the base reduces the tax');
  });
});

describe('Rule provenance is enforced, not decorative', () => {
  const allRules = [
    SDLT_RESIDENTIAL_STANDARD, SDLT_RESIDENTIAL_ADDITIONAL,
    SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT, SDLT_NON_RESIDENTIAL, CGT_RESIDENTIAL,
  ];

  test('every rule carries at least one primary citation with a URL and access date', () => {
    for (const rule of allRules) {
      assert.ok(rule.citations.length > 0, `${rule.id} has citations`);
      const primary = rule.citations.filter((c) => c.primary);
      assert.ok(primary.length > 0, `${rule.id} has a primary citation`);
      for (const c of primary) {
        assert.match(c.url, /^https:\/\//, `${rule.id} citation has a URL`);
        assert.match(c.accessed, /^\d{4}-\d{2}-\d{2}$/, `${rule.id} citation records an access date`);
      }
    }
  });

  test('every rule states an effective date, a tax year and a review date', () => {
    for (const rule of allRules) {
      assert.match(rule.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(rule.lastReviewed, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(rule.taxYear.length > 0);
    }
  });

  test('every rule declares what it does not cover', () => {
    for (const rule of allRules) {
      assert.ok(rule.limitations.length > 0, `${rule.id} declares its limitations`);
    }
  });

  test('a trace exposes the rule version and citations to the report layer', () => {
    const { trace } = evaluateRule(SDLT_RESIDENTIAL_ADDITIONAL, gbp('450000'));
    const json = trace.toJSON();
    assert.equal(json.rule.id, 'gb-eaw.sdlt.residential.additional');
    assert.equal(json.status, 'verified');
    assert.ok(json.rule.citations.length > 0);
    assert.ok(json.lines.length > 0, 'the band breakdown is in the trace');
    assert.ok(trace.citations().length > 0);
  });

  test('everything is in GBP and nothing leaks a dollar', () => {
    for (const rule of allRules) assert.equal(rule.currency, 'GBP');
  });

  test('a rule cannot be applied to a base in the wrong currency', () => {
    assert.throws(
      () => evaluateRule(SDLT_RESIDENTIAL_STANDARD, Money.of('295000', 'JPY')),
      /denominated in GBP but the base is JPY/,
    );
  });
});
