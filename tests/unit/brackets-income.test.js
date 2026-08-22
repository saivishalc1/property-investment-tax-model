import test from 'node:test';
import assert from 'node:assert/strict';
import {
  progressiveTax, marginalTax, longTermGainTax, section469Allowance, tablesFor, computeModel,
} from '../../src/calculations.js';
import { FEDERAL_ORDINARY, FEDERAL_LTCG, NEW_YORK_STATE, NEW_YORK_CITY } from '../../src/taxTables.js';
import { defaultState } from '../../src/storage.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !== ${b} (±${tol})`);

/* ------------------------------------------------------------------ *
 * Progressive tax
 * ------------------------------------------------------------------ */

test('federal ordinary tax is marginal, not the top rate on everything', () => {
  const t = FEDERAL_ORDINARY.single;
  // First bracket only.
  close(progressiveTax(t, 10000), 1000);
  // 10% on the first 12,400 then 12% on the rest.
  close(progressiveTax(t, 20000), 12400 * 0.10 + (20000 - 12400) * 0.12);
  // A $150,000 earner is in the 24% band, nowhere near 37%.
  close(marginalTax(t, 150000, 1000), 240);
  assert.ok(progressiveTax(t, 150000) / 150000 * 100 < 24,
    'the average rate must be below the marginal rate');
});

test('the top federal rate only applies above the top threshold', () => {
  const t = FEDERAL_ORDINARY.single;
  close(marginalTax(t, 700000, 1000), 370);
  close(marginalTax(t, 300000, 1000), 350);
  close(marginalTax(t, 120000, 1000), 240);
});

test('married filing jointly brackets are wider than single', () => {
  close(marginalTax(FEDERAL_ORDINARY.mfj, 150000, 1000), 220);
  close(marginalTax(FEDERAL_ORDINARY.single, 150000, 1000), 240);
});

test('a deductible loss returns a negative tax, i.e. a saving', () => {
  const saving = marginalTax(FEDERAL_ORDINARY.single, 150000, -10000);
  close(saving, -2400);
});

test('marginal tax never goes below zero income', () => {
  close(marginalTax(FEDERAL_ORDINARY.single, 5000, -20000), -progressiveTax(FEDERAL_ORDINARY.single, 5000));
});

/* ------------------------------------------------------------------ *
 * Capital gains stacking
 * ------------------------------------------------------------------ */

test('long-term gain stacks on ordinary income to find its band', () => {
  const t = FEDERAL_LTCG.single;
  // A low earner with a small gain pays nothing.
  close(longTermGainTax(t, 20000, 10000), 0);
  // Ordinary income already above the 0% ceiling: the whole gain is at 15%.
  close(longTermGainTax(t, 150000, 100000), 15000);
  // A gain that crosses the 20% threshold pays across two bands.
  const gain = 200000;
  const base = 450000;
  const expected = (533400 - base) * 0.15 + (base + gain - 533400) * 0.20;
  close(longTermGainTax(t, base, gain), expected);
  // And that is strictly less than the whole gain at 20%.
  assert.ok(longTermGainTax(t, base, gain) < gain * 0.20);
});

test('a modest earner is not charged the top capital gains rate', () => {
  const flatTwenty = 300000 * 0.20;
  assert.ok(longTermGainTax(FEDERAL_LTCG.single, 60000, 300000) < flatTwenty);
});

/* ------------------------------------------------------------------ *
 * §469(i) special allowance
 * ------------------------------------------------------------------ */

test('the $25,000 allowance phases out between $100k and $150k of MAGI', () => {
  assert.equal(section469Allowance(0, 'single'), 25000);
  assert.equal(section469Allowance(100000, 'single'), 25000);
  assert.equal(section469Allowance(110000, 'single'), 20000);
  assert.equal(section469Allowance(120000, 'single'), 15000);
  assert.equal(section469Allowance(140000, 'single'), 5000);
  assert.equal(section469Allowance(150000, 'single'), 0);
  assert.equal(section469Allowance(400000, 'single'), 0);
});

test('married filing separately gets no allowance under this model', () => {
  assert.equal(section469Allowance(50000, 'mfs'), 0);
});

test('a lower-income investor deducts losses now instead of suspending them all', () => {
  const s = defaultState();
  s.profile.otherMAGI = 90000;   // full $25,000 allowance available
  s.hold.rentMo = 3000;          // force a loss
  const r = computeModel(s);
  assert.ok(r.hold.allowanceCap === 25000);
  assert.ok(r.hold.allowanceUsedTotal > 0, 'some loss should be deductible now');
  assert.ok(r.hold.table[0].tax < 0, 'that produces a cash benefit in year one');

  const rich = structuredClone(s);
  rich.profile.otherMAGI = 200000;  // fully phased out
  const rr = computeModel(rich);
  assert.equal(rr.hold.allowanceCap, 0);
  assert.equal(rr.hold.allowanceUsedTotal, 0);
  assert.ok(rr.hold.suspendedAtSale > r.hold.suspendedAtSale,
    'with no allowance, more loss is carried to the sale');
});

test('turning off active participation removes the allowance', () => {
  const s = defaultState();
  s.profile.otherMAGI = 80000;
  s.hold.rentMo = 3000;
  s.profile.activeParticipation = false;
  const r = computeModel(s);
  assert.equal(r.hold.allowanceCap, 0);
  assert.equal(r.hold.allowanceUsedTotal, 0);
});

/* ------------------------------------------------------------------ *
 * Whole-model behaviour
 * ------------------------------------------------------------------ */

test('the bracket engine charges less than the flat top-rate model', () => {
  const s = defaultState();          // $150,000 other income
  const brackets = computeModel(s);
  const flatState = structuredClone(s);
  flatState.profile.rateMode = 'flat';
  const flat = computeModel(flatState);

  assert.ok(brackets.hold.ordinaryRate < flat.hold.ordinaryRate,
    'a $150k earner faces a lower marginal rate than the top statutory one');
  assert.ok(brackets.sale.fedCapGainsTax < flat.sale.fedCapGainsTax);
  assert.ok(brackets.sale.totalSaleTax < flat.sale.totalSaleTax);
});

test('unrecaptured §1250 gain is capped at 25%, never charged above it', () => {
  const s = defaultState();
  s.profile.otherMAGI = 900000;      // top bracket, well above 25%
  const r = computeModel(s);
  assert.ok(r.sale.effectiveRecaptureRate <= 25.000001);
  close(r.sale.fedRecaptureTax, r.sale.unrecaptured * 0.25, 0.01);
});

test('a low-income seller pays recapture below the 25% ceiling', () => {
  const s = defaultState();
  s.profile.otherMAGI = 0;
  s.hold.years = 3;
  const r = computeModel(s);
  assert.ok(r.sale.effectiveRecaptureRate < 25,
    'the ceiling is a maximum, not a flat rate');
});

test('flat mode still reproduces the single-rate behaviour exactly', () => {
  const s = defaultState();
  s.profile.rateMode = 'flat';
  const r = computeModel(s);
  close(r.hold.ordinaryRate, 37 + 6.85 + 3.876, 1e-9);
  close(r.sale.fedRecaptureTax, r.sale.unrecaptured * 0.25, 0.01);
  close(r.sale.fedCapGainsTax, r.sale.capitalGain * 0.20, 0.01);
});

test('a non-resident of the city pays no city tax under either engine', () => {
  for (const mode of ['brackets', 'flat']) {
    const s = defaultState();
    s.profile.rateMode = mode;
    s.profile.nycResident = false;
    const r = computeModel(s);
    assert.equal(r.sale.cityGainTax, 0, `city tax should be zero in ${mode} mode`);
  }
});

/* ------------------------------------------------------------------ *
 * Table sanity
 * ------------------------------------------------------------------ */

test('every rate table is ascending and starts at zero', () => {
  const tables = {
    'federal single': FEDERAL_ORDINARY.single, 'federal mfj': FEDERAL_ORDINARY.mfj,
    'LTCG single': FEDERAL_LTCG.single, 'LTCG mfj': FEDERAL_LTCG.mfj,
    'NYS single': NEW_YORK_STATE.single, 'NYS mfj': NEW_YORK_STATE.mfj,
    'NYC single': NEW_YORK_CITY.single, 'NYC mfj': NEW_YORK_CITY.mfj,
  };
  for (const [name, t] of Object.entries(tables)) {
    assert.equal(t[0].min, 0, `${name} must start at zero`);
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i].min > t[i - 1].min, `${name} thresholds must ascend`);
      assert.ok(t[i].rate >= t[i - 1].rate, `${name} rates must not fall`);
    }
  }
});

test('tablesFor falls back to single for an unknown filing status', () => {
  assert.deepEqual(tablesFor('nonsense').fedOrdinary, FEDERAL_ORDINARY.single);
});

test('published New York rates appear where expected', () => {
  assert.equal(NEW_YORK_STATE.single.at(-1).rate, 10.9);
  assert.equal(NEW_YORK_CITY.single.at(-1).rate, 3.876);
  assert.equal(FEDERAL_ORDINARY.single.at(-1).rate, 37);
  assert.equal(FEDERAL_LTCG.single.at(-1).rate, 20);
});
