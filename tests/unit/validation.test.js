import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, isValid } from '../../src/validation.js';
import { defaultState } from '../../src/storage.js';

const errPaths = (s) => validate(s).errors.map((e) => e.path);

test('the default scenario is valid and warning-free', () => {
  const { errors, warnings } = validate(defaultState());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('a zero or missing purchase price is an error against that field', () => {
  const s = defaultState();
  s.purchase.price = 0;
  assert.ok(errPaths(s).includes('purchase.price'));
  s.purchase.price = '';
  const e = validate(s).errors.find((x) => x.path === 'purchase.price');
  assert.match(e.message, /required/i);
});

test('out-of-range percentages are caught', () => {
  const s = defaultState();
  s.purchase.downPct = 140;
  s.hold.vacancyPct = -5;
  s.purchase.loanRate = 45;
  const paths = errPaths(s);
  assert.ok(paths.includes('purchase.downPct'));
  assert.ok(paths.includes('hold.vacancyPct'));
  assert.ok(paths.includes('purchase.loanRate'));
});

test('non-numeric input is reported, not silently coerced', () => {
  const s = defaultState();
  s.hold.rentMo = 'abc';
  const e = validate(s).errors.find((x) => x.path === 'hold.rentMo');
  assert.ok(e);
  assert.match(e.message, /must be a number/i);
  assert.equal(s.hold.rentMo, 'abc', 'validation must never rewrite the user input');
});

test('an interest-only period longer than the term is a cross-field error', () => {
  const s = defaultState();
  s.purchase.ioYears = 35;
  s.purchase.loanTermYrs = 30;
  const e = validate(s).errors.find((x) => x.path === 'purchase.ioYears');
  assert.ok(e);
  assert.match(e.message, /longer than the loan term/i);
});

test('improvements placed in service after the sale are an error', () => {
  const s = defaultState();
  s.hold.years = 5;
  s.hold.capexTotal = 50000;
  s.profile.capexYear = 9;
  assert.ok(errPaths(s).includes('profile.capexYear'));
  s.hold.capexTotal = 0;
  assert.ok(!errPaths(s).includes('profile.capexYear'), 'no improvement spend, no error');
});

test('choosing an explicit sale price without entering one is an error', () => {
  const s = defaultState();
  s.sale.useOverride = true;
  s.sale.overridePrice = 0;
  assert.ok(errPaths(s).includes('sale.overridePrice'));
});

test('warnings flag modelled-but-caveated assumptions without blocking the run', () => {
  const s = defaultState();
  s.purchase.landPct = 0;
  s.hold.passiveAllowed = true;
  const { errors, warnings } = validate(s);
  assert.deepEqual(errors, []);
  assert.ok(isValid(s));
  assert.ok(warnings.some((w) => /land is never depreciable/i.test(w)));
  assert.ok(warnings.some((w) => /§469/.test(w)));
});

test('experimental presets always warn', () => {
  const s = defaultState();
  s.meta.preset = 'uk';
  assert.ok(validate(s).warnings.some((w) => /experimental/i.test(w)));
});

test('corporate ownership warns that entity-level tax is out of scope', () => {
  const s = defaultState();
  s.profile.ownerType = 'corporation';
  assert.ok(validate(s).warnings.some((w) => /entity level/i.test(w)));
});

test('every error carries a field path and a human-readable label', () => {
  const s = defaultState();
  s.purchase.price = -1;
  s.hold.years = 99;
  for (const e of validate(s).errors) {
    assert.equal(typeof e.path, 'string');
    assert.ok(e.path.includes('.'));
    assert.ok(e.label && e.label.length > 1);
    assert.ok(e.message.endsWith('.'));
  }
});
