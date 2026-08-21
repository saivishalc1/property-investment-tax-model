import test from 'node:test';
import assert from 'node:assert/strict';
import { bracketRate, bracketTax } from '../../src/calculations.js';
import { PRESETS } from '../../src/presets.js';

const nyc = PRESETS['us-nyc'].rates;

test('bracketRate returns the rate of the highest band reached', () => {
  const t = [{ min: 0, rate: 1 }, { min: 100, rate: 2 }, { min: 200, rate: 3 }];
  assert.equal(bracketRate(t, 0), 1);
  assert.equal(bracketRate(t, 99.99), 1);
  assert.equal(bracketRate(t, 100), 2);
  assert.equal(bracketRate(t, 1e9), 3);
  assert.equal(bracketRate([], 500), 0);
});

test('whole-price brackets re-rate the entire value at a threshold (the NY cliff)', () => {
  // NYC mansion tax: nothing below $1M, then 1% of the WHOLE price.
  assert.equal(bracketTax(nyc.mansion, 999999, false), 0);
  assert.equal(bracketTax(nyc.mansion, 1000000, false), 10000);
  // One dollar over $2M re-rates the whole price from 1% to 1.25%.
  assert.equal(bracketTax(nyc.mansion, 1999999, false).toFixed(2), '19999.99');
  assert.equal(bracketTax(nyc.mansion, 2000000, false), 25000);
  // The cliff costs more than the extra dollar of price by a wide margin.
  const jump = bracketTax(nyc.mansion, 2000000, false) - bracketTax(nyc.mansion, 1999999, false);
  assert.ok(jump > 5000, 'crossing the $2M threshold must cost more than $5,000');
});

test('NYC real property transfer tax steps at $500,000 on the whole price', () => {
  assert.equal(bracketTax(nyc.cityTransferRes, 500000, false), 5000);          // 1.0%
  assert.equal(bracketTax(nyc.cityTransferRes, 600000, false), 8550);          // 1.425%
  assert.equal(bracketTax(nyc.cityTransferComm, 400000, false), 5700);         // 1.425%
  assert.equal(bracketTax(nyc.cityTransferComm, 600000, false), 15750);        // 2.625%
});

test('NYS transfer tax is 0.4% and steps to 0.65% for residential above $3M', () => {
  assert.equal(bracketTax(nyc.stateTransferRes, 1000000, false), 4000);
  assert.equal(bracketTax(nyc.stateTransferRes, 3000000, false), 19500);
  // Commercial crosses at $2M instead of $3M.
  assert.equal(bracketTax(nyc.stateTransferComm, 2000000, false), 13000);
  assert.equal(bracketTax(nyc.stateTransferRes, 2000000, false), 8000);
});

test('marginal brackets tax each slice at its own rate', () => {
  const t = [{ min: 0, rate: 0 }, { min: 100, rate: 10 }, { min: 200, rate: 20 }];
  // (200-100) at 10% = 10, plus (250-200) at 20% = 10.
  assert.equal(bracketTax(t, 250, true), 20);
  assert.equal(bracketTax(t, 150, true), 5);
  assert.equal(bracketTax(t, 100, true), 0);
});

test('marginal and whole-price give materially different answers on the same table', () => {
  const t = [{ min: 0, rate: 1 }, { min: 500000, rate: 2 }];
  assert.equal(bracketTax(t, 600000, false), 12000); // whole price at 2%
  assert.equal(bracketTax(t, 600000, true), 7000);   // 500k at 1% + 100k at 2%
});

test('bracket helpers are safe on empty, zero and negative input', () => {
  assert.equal(bracketTax(null, 100, false), 0);
  assert.equal(bracketTax([], 100, true), 0);
  assert.equal(bracketTax(nyc.mansion, 0, false), 0);
  assert.equal(bracketTax(nyc.mansion, -5, false), 0);
});

test('mortgage recording tax uses the LOAN amount, not the price', () => {
  assert.equal(bracketRate(nyc.mrtResidential, 499999), 1.8);
  assert.equal(bracketRate(nyc.mrtResidential, 500000), 1.925);
});
