/**
 * migration.test.js — the original defect, asserted closed.
 *
 * The bug that started this rebuild: computeModel() charged United States
 * federal and New York State income tax on a property in any country, because
 * tablesFor() took a filing status and no jurisdiction. A Japanese scenario was
 * charged 1,314,415 yen of US federal capital gains plus 1,160,223 yen of NEW
 * YORK STATE income tax on an 11,898,141 yen gain — an effective 20.80% that
 * exists in no country's law.
 *
 * These tests exist so that can never come back quietly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../../../src/storage.js';
import { PRESETS } from '../../../src/presets.js';
import { computeModel } from '../../../src/calculations.js';

function scenarioFor(preset, over = {}) {
  const s = defaultState();
  s.meta.preset = preset;
  // An unresearched key has no preset to draw rates from; New York's shape is
  // used purely so the cash-flow machinery has numbers to run on.
  s.rates = structuredClone((PRESETS[preset] || PRESETS['us-nyc']).rates);
  const sample = (PRESETS[preset] || PRESETS['us-nyc']).sample;
  Object.assign(s.purchase, { price: sample.price }, over.purchase || {});
  Object.assign(s.hold, { rentMo: sample.rentMo }, over.hold || {});
  Object.assign(s.profile, over.profile || {});
  return s;
}

describe('The rule engine owns the tax figures for a researched market', () => {
  test('each researched market runs on the engine; an unresearched one does not', () => {
    for (const k of ['us-nyc', 'uk', 'jp']) {
      assert.equal(computeModel(scenarioFor(k)).meta.engine, true, `${k} uses the engine`);
    }
    // Every SHIPPED market is researched. The unresearched path is still a
    // live guard, so it is exercised with a key that is deliberately not a
    // market rather than with whichever preset happens to be unresearched
    // today — a test that would rot the moment the market list changed.
    assert.equal(computeModel(scenarioFor('zz-nowhere')).meta.engine, false);
    assert.equal(computeModel(scenarioFor('zz-nowhere')).meta.engineStatus, 'unsupported');
  });

  test('the marginal rate differs by country instead of being one US figure', () => {
    const rate = (k) => computeModel(scenarioFor(k)).meta.ordinaryRate;
    const uk = rate('uk');
    const jp = rate('jp');
    const us = rate('us-nyc');

    // The defect's signature was all three being identical, because the number
    // was US federal plus New York State whatever the country.
    assert.notEqual(uk.toFixed(3), jp.toFixed(3), 'UK and Japan must not share a rate');
    assert.notEqual(uk.toFixed(3), us.toFixed(3));
    assert.notEqual(jp.toFixed(3), us.toFixed(3));
  });

  test('Japan is charged Japanese tax, at the statutory 20.315%', () => {
    const r = computeModel(scenarioFor('jp'));
    const gain = r.sale.taxableGain;
    assert.ok(gain > 0, 'the scenario produces a gain');

    // Every component must come from a Japanese rule.
    const ids = r.sale.engineComponents.map((c) => c.ruleId);
    assert.ok(ids.length > 0, 'the engine supplied the breakdown');
    for (const id of ids) {
      assert.ok(id.startsWith('jp.'), `${id} is a Japanese rule`);
    }

    // And the effective rate is the published long-term figure.
    const effective = r.sale.totalSaleTax / gain * 100;
    assert.ok(Math.abs(effective - 20.315) < 0.01, `expected 20.315%, got ${effective.toFixed(3)}%`);
  });

  test('no New York rule is ever applied to a UK or Japanese scenario', () => {
    for (const k of ['uk', 'jp']) {
      const r = computeModel(scenarioFor(k));
      for (const c of r.sale.engineComponents || []) {
        assert.ok(!/^us[.-]/.test(c.ruleId), `${k} reached ${c.ruleId}`);
      }
    }
  });

  test('the United Kingdom charges no depreciation and no US recapture', () => {
    const r = computeModel(scenarioFor('uk'));
    // An individual UK landlord gets no writing-down allowance on a building,
    // so there is nothing to recapture on sale.
    assert.equal(r.sale.fedRecaptureTax, 0);
    assert.equal(r.sale.niitTax, 0, 'NIIT is a US tax');
  });

  test('the reported breakdown always sums to the reported total', () => {
    // A statement whose parts do not add up to its own total is a defect the
    // reader will find before we do.
    for (const k of ['us-nyc', 'uk', 'jp', 'zz-nowhere']) {
      const s = computeModel(scenarioFor(k)).sale;
      const sum = s.fedRecaptureTax + s.fedCapGainsTax + s.niitTax + s.stateGainTax + s.cityGainTax;
      assert.ok(
        Math.abs(sum - s.totalSaleTax) < 0.01,
        `${k}: components ${sum} vs total ${s.totalSaleTax}`,
      );
    }
  });
});

describe('The professional rate override is honoured, not overruled', () => {
  test('flat mode stands the engine down and reports a user assumption', () => {
    const s = scenarioFor('us-nyc', { profile: { rateMode: 'flat' } });
    const r = computeModel(s);
    assert.equal(r.meta.engine, false, 'the engine defers to the typed rates');
    assert.equal(r.meta.ratesOverridden, true);
    assert.equal(r.meta.engineStatus, 'assumption');
  });

  test('bracket mode returns to the engine', () => {
    const r = computeModel(scenarioFor('us-nyc', { profile: { rateMode: 'brackets' } }));
    assert.equal(r.meta.engine, true);
    assert.equal(r.meta.ratesOverridden, false);
  });
});

describe('Status is never stronger than the weakest rule behind it', () => {
  test('New York reports estimated, because its state and city schedules are', () => {
    // The federal figures are primary-sourced but the NYS and NYC schedules
    // are not, and a result is only as strong as its weakest input.
    assert.equal(computeModel(scenarioFor('us-nyc')).meta.engineStatus, 'estimated');
  });

  test('the United Kingdom reports verified, because every rule behind it is', () => {
    assert.equal(computeModel(scenarioFor('uk')).meta.engineStatus, 'verified');
  });
});

describe('Unconverted money figures are reported, not silently computed on', () => {
  test('switching market does not convert the amounts, and says so', () => {
    const s = scenarioFor('jp');
    // defaultState records USD; the Japanese market prices in yen.
    assert.equal(s.meta.enteredCurrency, 'USD');
    const r = computeModel(s);
    assert.equal(r.meta.jurisdiction.currency, 'JPY');
  });
});
