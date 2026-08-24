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
  s.sale.saleBasis = 'price';
  s.sale.overridePrice = 0;
  assert.ok(errPaths(s).includes('sale.overridePrice'));
});

test('choosing an exit cap basis without a cap rate is an error', () => {
  const s = defaultState();
  s.sale.saleBasis = 'exitCap';
  s.sale.exitCapPct = 0;
  assert.ok(errPaths(s).includes('sale.exitCapPct'));
});

test('valuing the exit off a cap rate warns about the assumption', () => {
  const s = defaultState();
  s.sale.saleBasis = 'exitCap';
  const { errors, warnings } = validate(s);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /cap rate/i.test(w)));
});

test('rentable area and unit count are range-checked', () => {
  const s = defaultState();
  s.purchase.sqft = -5;
  s.purchase.units = -1;
  const paths = errPaths(s);
  assert.ok(paths.includes('purchase.sqft'));
  assert.ok(paths.includes('purchase.units'));
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

test('a market with no researched rule pack always warns', () => {
  // Germany, France, Texas and the rest carry hand-entered rates with no
  // effective dates and no citations. Every one of them must say so.
  for (const preset of ['zz-nowhere', 'xx-unknown']) {
    const s = defaultState();
    s.meta.preset = preset;
    const warnings = validate(s).warnings;
    assert.ok(
      warnings.some((w) => /no researched rule pack/i.test(w)),
      `${preset} must warn that it is unresearched`,
    );
  }
});

test('a researched market does not carry the unresearched warning', () => {
  // The United Kingdom and Japan now have packs checked against HMRC and the
  // NTA. Warning about them alongside Germany would flatten the distinction
  // the coverage model exists to make.
  for (const preset of ['us-nyc', 'uk', 'jp']) {
    const s = defaultState();
    s.meta.preset = preset;
    const warnings = validate(s).warnings;
    assert.ok(
      !warnings.some((w) => /no researched rule pack/i.test(w)),
      `${preset} is researched and must not be flagged unresearched`,
    );
  }
});

test('the old us- prefix test warned on exactly the wrong markets', () => {
  // A regression guard for the specific defect: the previous rule keyed off
  // whether the preset id began with "us-", so Texas and Florida — which have
  // no rule pack — were silently trusted while the UK was flagged.
  const tx = defaultState(); tx.meta.preset = 'zz-nowhere';
  assert.ok(validate(tx).warnings.some((w) => /no researched rule pack/i.test(w)));

  const uk = defaultState(); uk.meta.preset = 'uk';
  assert.ok(!validate(uk).warnings.some((w) => /no researched rule pack/i.test(w)));
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
