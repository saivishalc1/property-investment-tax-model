/**
 * validation.js — field-level validation and scenario-level warnings.
 *
 * Two separate ideas, deliberately kept apart:
 *
 *   ERRORS   The model cannot produce a meaningful number until this is fixed.
 *            Reported against a specific field so the UI can mark the input,
 *            attach the message with aria-describedby, and link to it from the
 *            error summary.
 *
 *   WARNINGS The model will run, but the result carries a caveat the user
 *            needs to see — an assumption outside the modelled rules, or a
 *            combination the engine simplifies.
 *
 * Validation NEVER alters the user's input. A value that fails is reported and
 * left exactly as typed.
 */

import { jurisdictionFor, COVERAGE } from './engine/jurisdiction.js';

const RULES = [
  // path,                  label,                          min,   max,     required
  ['purchase.price', 'Purchase price', 1, 1e12, true],
  ['purchase.landPct', 'Land share of value', 0, 100],
  ['purchase.sqft', 'Rentable area', 0, 1e8],
  ['purchase.units', 'Number of units', 0, 100000],
  ['purchase.downPct', 'Down payment', 0, 100],
  ['purchase.loanRate', 'Interest rate', 0, 30],
  ['purchase.loanTermYrs', 'Loan term', 1, 50],
  ['purchase.ioYears', 'Interest-only period', 0, 50],
  ['purchase.pointsPct', 'Origination points', 0, 10],
  ['purchase.titlePct', 'Title insurance', 0, 10],
  ['purchase.legal', 'Legal fees', 0, 1e9],
  ['purchase.inspection', 'Inspection and appraisal', 0, 1e9],
  ['purchase.otherBuy', 'Other buyer costs', 0, 1e9],
  ['hold.years', 'Hold period', 1, 50, true],
  ['hold.rentMo', 'Monthly rent', 0, 1e9],
  ['hold.otherIncomeYr', 'Other income', 0, 1e9],
  ['hold.vacancyPct', 'Vacancy and credit loss', 0, 100],
  ['hold.rentGrowthPct', 'Rent growth', -20, 30],
  ['hold.opexGrowthPct', 'Expense inflation', -20, 30],
  ['hold.apprPct', 'Appreciation', -20, 30],
  ['hold.propTaxYr', 'Property tax', 0, 1e9],
  ['hold.insuranceYr', 'Insurance', 0, 1e9],
  ['hold.hoaMo', 'HOA / common charges', 0, 1e9],
  ['hold.utilitiesYr', 'Utilities', 0, 1e9],
  ['hold.otherOpexYr', 'Other operating expenses', 0, 1e9],
  ['hold.maintPct', 'Maintenance', 0, 100],
  ['hold.mgmtPct', 'Management', 0, 100],
  ['hold.capexTotal', 'Capital improvements', 0, 1e10],
  ['sale.overridePrice', 'Sale price', 0, 1e12],
  ['sale.brokerPct', 'Broker commission', 0, 20],
  ['sale.flipTaxPct', 'Co-op flip tax', 0, 20],
  ['sale.sellLegal', 'Legal and closing', 0, 1e9],
  ['sale.otherSell', 'Other selling costs', 0, 1e9],
  ['sale.saleMonth', 'Month of sale', 1, 12],
  ['sale.exitCapPct', 'Exit cap rate', 0, 50],
  ['profile.otherMAGI', 'Other income (MAGI)', 0, 1e10],
  ['profile.serviceMonth', 'Month placed in service', 1, 12],
  ['profile.capexYear', 'Improvement year', 1, 50],
  ['profile.capexMonth', 'Improvement month', 1, 12],
];

function at(obj, path) {
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

function fmt(n) {
  return Number.isFinite(n) && Math.abs(n) >= 1000
    ? n.toLocaleString('en-US')
    : String(n);
}

/**
 * @returns {{ errors: Array<{path,label,message}>, warnings: string[] }}
 */
export function validate(state) {
  const errors = [];
  const warnings = [];

  for (const [path, label, min, max, required] of RULES) {
    const raw = at(state, path);
    if (raw === '' || raw === null || raw === undefined) {
      if (required) errors.push({ path, label, message: `${label} is required.` });
      continue;
    }
    const v = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!Number.isFinite(v)) {
      errors.push({ path, label, message: `${label} must be a number.` });
      continue;
    }
    if (v < min || v > max) {
      errors.push({
        path,
        label,
        message: `${label} must be between ${fmt(min)} and ${fmt(max)}.`,
      });
    }
  }

  // --- cross-field errors ------------------------------------------------
  const p = state.purchase, h = state.hold, sa = state.sale, pr = state.profile;

  if (Number(p.ioYears) > Number(p.loanTermYrs)) {
    errors.push({
      path: 'purchase.ioYears',
      label: 'Interest-only period',
      message: 'The interest-only period cannot be longer than the loan term.',
    });
  }
  if (Number(pr.capexYear) > Number(h.years) && Number(h.capexTotal) > 0) {
    errors.push({
      path: 'profile.capexYear',
      label: 'Improvement year',
      message: 'Improvements are placed in service after the property is sold. Lower the year or lengthen the hold.',
    });
  }
  if (sa.saleBasis === 'price' && !(Number(sa.overridePrice) > 0)) {
    errors.push({
      path: 'sale.overridePrice',
      label: 'Sale price',
      message: 'Enter a sale price above zero, or value the exit another way.',
    });
  }
  if (sa.saleBasis === 'exitCap' && !(Number(sa.exitCapPct) > 0)) {
    errors.push({
      path: 'sale.exitCapPct',
      label: 'Exit cap rate',
      message: 'Enter an exit cap rate above zero, or value the exit another way.',
    });
  }

  // --- warnings ----------------------------------------------------------
  if (pr.ownerType === 'corporation') {
    warnings.push('Corporate ownership is taxed at entity level with rules this model does not include. Results assume a pass-through owner.');
  }
  if (pr.usTaxResident === false && String(state.meta.preset).startsWith('us-')) {
    warnings.push('Non-resident sellers of US real property face FIRPTA withholding and treaty rules that are not modelled.');
  }
  if (Number(p.downPct) === 0) {
    warnings.push('A 100% loan-to-value purchase is modelled literally; no lender constraint is applied.');
  }
  if (Number(p.downPct) === 100) {
    warnings.push('All-cash purchase: mortgage recording tax, points and loan-cost amortisation are all zero.');
  }
  if (Number(h.rentGrowthPct) > 8 || Number(h.apprPct) > 8) {
    warnings.push('Growth above 8% a year compounds hard over a long hold. Check that this is what you intend.');
  }
  if (Number(h.years) > 27.5 && state.purchase.propType !== 'commercial') {
    warnings.push('The hold period exceeds the 27.5-year residential recovery period, so depreciation stops before the sale.');
  }
  if (h.passiveAllowed) {
    warnings.push('Rental losses are being deducted in the year they arise. Under US §469 most individual investors must suspend them instead.');
  }
  if (Number(p.landPct) === 0) {
    warnings.push('A 0% land share depreciates the entire purchase price. Land is never depreciable; a typical NYC allocation is 20–30%.');
  }
  if (Number(p.landPct) > 60) {
    warnings.push('A land share above 60% leaves very little depreciable basis. Confirm the allocation against your appraisal or tax bill.');
  }
  if (sa.saleBasis === 'exitCap' && Number(sa.exitCapPct) > 0 && Number(h.rentMo) > 0) {
    // A tighter exit than entry assumes the market re-rates in your favour.
    warnings.push('You are valuing the exit off a cap rate. If that cap is tighter than the going-in cap, the model is assuming the market improves — worth being able to defend.');
  }
  if (Number(p.units) > 1 && state.purchase.propType === 'coop') {
    warnings.push('Co-op ownership is share-based, so a multi-unit co-op is unusual. Check the unit count.');
  }
  // Whether a market is researched is decided by the rule registry, not by
  // whether its key happens to begin with "us-". That prefix test was wrong in
  // both directions: it flagged the United Kingdom and Japan, which now have
  // researched packs, and stayed silent on Texas, Florida and California,
  // which have none.
  const coverage = jurisdictionFor(state.meta.preset);
  if (coverage.coverage !== COVERAGE.MODELLED) {
    warnings.push(
      'This market has no researched rule pack. Its rates were entered by hand with no effective dates, '
      + 'no source citations and no verification. Treat any figure as a rough sketch, not a calculation '
      + 'you can rely on or show a client.',
    );
  }
  // A modelled market's scope note (which regions it covers, what is not yet
  // entered) is SCOPE, not a caveat about this scenario. It belongs on the
  // market badge and in the report's sources section, where it is already
  // shown. Pushing it here would make the default scenario warn every time and
  // train the user to skim past the warnings that do need action.

  return { errors, warnings };
}

/** Convenience: is the scenario safe to compute? */
export function isValid(state) {
  return validate(state).errors.length === 0;
}
