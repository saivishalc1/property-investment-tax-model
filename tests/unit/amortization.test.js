import test from 'node:test';
import assert from 'node:assert/strict';
import { amortize } from '../../src/calculations.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !== ${b} (±${tol})`);

test('level payment matches the standard annuity formula', () => {
  const { monthlyPaymentAmort } = amortize(300000, 6, 30, 30, 0);
  close(monthlyPaymentAmort, 1798.65, 0.01);
});

test('the schedule fully retires the loan over the term', () => {
  const { schedule } = amortize(300000, 6, 30, 30, 0);
  close(schedule[29].balance, 0, 0.01);
  const totalPrincipal = schedule.reduce((s, y) => s + y.principal, 0);
  close(totalPrincipal, 300000, 0.05);
});

test('year one splits into the correct interest and principal', () => {
  const { schedule } = amortize(300000, 6, 30, 5, 0);
  // First month interest is exactly 300000 * 0.005 = 1500.
  close(schedule[0].interest + schedule[0].principal, 1798.65 * 12, 0.05);
  // Closed form: P[(1+r)^12 - 1] / [(1+r)^360 - 1] = 3684.04
  const r = 0.005;
  const closedForm = 300000 * (Math.pow(1 + r, 12) - 1) / (Math.pow(1 + r, 360) - 1);
  close(schedule[0].principal, closedForm, 0.02);
  close(schedule[0].principal, 3684.04, 0.05);
  close(schedule[0].balance, 300000 - schedule[0].principal, 0.01);
});

test('zero-interest financing does not divide by zero', () => {
  const { monthlyPaymentAmort, schedule } = amortize(120000, 0, 10, 10, 0);
  close(monthlyPaymentAmort, 1000, 0.001);
  assert.equal(schedule[0].interest, 0);
  close(schedule[0].principal, 12000, 0.001);
  close(schedule[9].balance, 0, 0.001);
});

test('an interest-only period holds the balance flat, then the payment steps up', () => {
  const io = amortize(500000, 5, 30, 30, 5);
  // Nothing amortises during the first five years.
  for (let y = 0; y < 5; y++) {
    close(io.schedule[y].principal, 0, 0.0001);
    close(io.schedule[y].balance, 500000, 0.0001);
    close(io.schedule[y].interest, 500000 * 0.05 / 12 * 12, 0.01);
  }
  // The step-up payment retires the ORIGINAL balance over 300 months.
  const straight = amortize(500000, 5, 25, 25, 0);
  close(io.monthlyPaymentAmort, straight.monthlyPaymentAmort, 0.01);
  // And it is higher than the payment on a plain 30-year loan.
  const plain = amortize(500000, 5, 30, 30, 0);
  assert.ok(io.monthlyPaymentAmort > plain.monthlyPaymentAmort);
  // The loan is still fully repaid by the end of the term.
  close(io.schedule[29].balance, 0, 0.02);
});

test('interest-only payment is reported separately from the amortising payment', () => {
  const io = amortize(500000, 5, 30, 10, 5);
  close(io.monthlyPaymentIO, 500000 * 0.05 / 12, 0.001);
  assert.ok(io.monthlyPaymentAmort > io.monthlyPaymentIO);
  assert.equal(io.ioMonths, 60);
});

test('an interest-only period as long as the term never amortises', () => {
  const io = amortize(100000, 4, 10, 10, 10);
  assert.equal(io.schedule[9].balance, 100000);
  assert.equal(io.schedule.reduce((s, y) => s + y.principal, 0), 0);
});

test('holding longer than the loan term reports zeros, not negative interest', () => {
  const a = amortize(200000, 5, 10, 15, 0);
  assert.equal(a.schedule.length, 15);
  close(a.schedule[9].balance, 0, 0.01);
  assert.equal(a.schedule[12].interest, 0);
  assert.equal(a.schedule[12].principal, 0);
  assert.equal(a.schedule[14].balance, 0);
});

test('an all-cash purchase produces a zero schedule', () => {
  const a = amortize(0, 6, 30, 5, 0);
  assert.equal(a.monthlyPaymentAmort, 0);
  assert.equal(a.schedule[0].interest, 0);
  assert.equal(a.schedule[4].balance, 0);
});
