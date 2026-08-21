import test from 'node:test';
import assert from 'node:assert/strict';
import { computeModel, computeVariant, npv, irr, niitTax, midMonthPlacedFraction, midMonthDisposalFraction } from '../../src/calculations.js';
import { defaultState } from '../../src/storage.js';
import { PRESETS } from '../../src/presets.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !== ${b} (±${tol})`);

/** A deterministic, deliberately simple scenario: all cash, no growth, no improvements. */
function simple(overrides = {}) {
  const s = defaultState();
  s.purchase.price = 1000000;
  s.purchase.downPct = 100;
  s.purchase.landPct = 20;
  s.purchase.titlePct = 0;
  s.purchase.legal = 0;
  s.purchase.inspection = 0;
  s.purchase.otherBuy = 0;
  s.purchase.pointsPct = 0;
  s.hold.rentMo = 5000;
  s.hold.otherIncomeYr = 0;
  s.hold.vacancyPct = 0;
  s.hold.rentGrowthPct = 0;
  s.hold.opexGrowthPct = 0;
  s.hold.apprPct = 0;
  s.hold.propTaxYr = 10000;
  s.hold.insuranceYr = 0;
  s.hold.hoaMo = 0;
  s.hold.utilitiesYr = 0;
  s.hold.otherOpexYr = 0;
  s.hold.maintPct = 0;
  s.hold.mgmtPct = 0;
  s.hold.capexTotal = 0;
  s.hold.years = 5;
  s.sale.brokerPct = 0;
  s.sale.sellLegal = 0;
  s.sale.otherSell = 0;
  s.sale.saleMonth = 12;
  s.profile.serviceMonth = 1;
  Object.assign(s.purchase, overrides.purchase || {});
  Object.assign(s.hold, overrides.hold || {});
  Object.assign(s.sale, overrides.sale || {});
  Object.assign(s.profile, overrides.profile || {});
  return s;
}

/* ---------------- basis ---------------- */

test('cost basis includes acquisition costs but never loan costs', () => {
  const s = defaultState();
  s.purchase.price = 1000000;
  s.purchase.downPct = 70;      // $300,000 loan
  s.purchase.titlePct = 0.5;    // $5,000
  s.purchase.legal = 4000;
  s.purchase.inspection = 1000;
  s.purchase.otherBuy = 0;
  s.purchase.pointsPct = 1;     // $3,000 — a loan cost
  const r = computeModel(s);

  // Mansion tax at $1M is 1% = $10,000 and it capitalises.
  close(r.purchase.mansionTax, 10000);
  close(r.purchase.basisCosts, 10000 + 5000 + 4000 + 1000);
  close(r.purchase.costBasis, 1000000 + 20000);

  // Points and mortgage recording tax are financing costs, not basis.
  close(r.purchase.points, 3000);
  assert.ok(r.purchase.mortgageRecordingTax > 0);
  close(r.purchase.financingCosts, 3000 + r.purchase.mortgageRecordingTax);
  close(r.purchase.cashAtClosing, 700000 + r.purchase.basisCosts + r.purchase.financingCosts);
});

test('transfer tax enters basis only when the buyer actually pays it', () => {
  const seller = defaultState();
  seller.purchase.transferTaxPayer = 'seller';
  const buyer = structuredClone(seller);
  buyer.purchase.transferTaxPayer = 'buyer';

  const a = computeModel(seller);
  const b = computeModel(buyer);
  assert.equal(a.purchase.buyerTransfer, 0);
  close(b.purchase.buyerTransfer, a.purchase.stateTransfer + a.purchase.cityTransfer);
  close(b.purchase.costBasis - a.purchase.costBasis, b.purchase.buyerTransfer);
  // and it is real cash out the door
  close(b.purchase.cashAtClosing - a.purchase.cashAtClosing, b.purchase.buyerTransfer);
});

test('co-ops pay no mortgage recording tax and no title insurance', () => {
  const s = defaultState();
  s.purchase.propType = 'coop';
  s.purchase.price = 1200000; // above the $1M mansion-tax threshold
  s.purchase.titlePct = 0.45;
  const r = computeModel(s);
  assert.equal(r.purchase.mortgageRecordingTax, 0);
  assert.equal(r.purchase.titleIns, 0);
  // but the mansion tax and the transfer taxes still apply to co-op shares
  assert.ok(r.purchase.mansionTax > 0);
  assert.ok(r.purchase.stateTransfer > 0);
});

test('commercial property uses the 39-year recovery period', () => {
  const res = computeModel(defaultState());
  const s = defaultState();
  s.purchase.propType = 'commercial';
  const com = computeModel(s);
  assert.equal(res.hold.depLife, 27.5);
  assert.equal(com.hold.depLife, 39);
  assert.equal(com.purchase.mansionTax, 0, 'the mansion tax is residential-only');
});

/* ---------------- depreciation ---------------- */

test('mid-month convention prorates the first year and the year of sale', () => {
  close(midMonthPlacedFraction(1), 11.5 / 12, 1e-9);
  close(midMonthPlacedFraction(7), 5.5 / 12, 1e-9);
  close(midMonthDisposalFraction(12), 11.5 / 12, 1e-9);
  close(midMonthDisposalFraction(6), 5.5 / 12, 1e-9);

  const s = simple({ profile: { serviceMonth: 7 }, sale: { saleMonth: 6 } });
  const r = computeModel(s);
  const full = r.purchase.depreciableBasis / 27.5;
  close(r.hold.table[0].dep, full * (5.5 / 12), 0.01);
  close(r.hold.table[1].dep, full, 0.01);
  close(r.hold.table[4].dep, full * (5.5 / 12), 0.01);
});

test('capital improvements are fully depreciable — no land is carved out', () => {
  const s = simple({ hold: { capexTotal: 100000 }, profile: { capexYear: 2, capexMonth: 1 } });
  const r = computeModel(s);
  const buildingFull = r.purchase.depreciableBasis / 27.5;
  const capexFull = 100000 / 27.5;

  assert.equal(r.hold.annualCapexDep, capexFull, 'the whole improvement is depreciable');
  // Year 1: no improvement yet.
  close(r.hold.table[0].dep, buildingFull * (11.5 / 12), 0.01);
  // Year 2: building plus the improvement, mid-month from month 1.
  close(r.hold.table[1].dep, buildingFull + capexFull * (11.5 / 12), 0.01);
  // Year 3: both at a full year.
  close(r.hold.table[2].dep, buildingFull + capexFull, 0.01);
});

test('improvements increase adjusted basis and reduce the gain', () => {
  const base = computeModel(simple());
  const withCapex = computeModel(simple({ hold: { capexTotal: 100000 }, profile: { capexYear: 1 } }));
  close(withCapex.sale.adjustedBasis - base.sale.adjustedBasis,
    100000 - (withCapex.sale.accumDep - base.sale.accumDep), 0.01);
});

test('accumulated depreciation never exceeds the depreciable basis', () => {
  const s = simple({ hold: { years: 40 } });
  const r = computeModel(s);
  assert.ok(r.hold.accumDep <= r.purchase.depreciableBasis + 1e-6);
  const lastYears = r.hold.table.slice(30);
  assert.ok(lastYears.every((y) => y.dep === 0), 'depreciation stops after the recovery period');
});

/* ---------------- loan costs ---------------- */

test('loan costs amortise over the term and the remainder is deducted at sale', () => {
  const s = defaultState();
  s.hold.years = 5;
  s.purchase.loanTermYrs = 30;
  const r = computeModel(s);
  const annual = r.purchase.financingCosts / 30;
  close(r.hold.annualFinancingDeduction, annual, 0.01);
  for (let y = 0; y < 4; y++) close(r.hold.table[y].financingDeduction, annual, 0.01);
  // The final year picks up everything still unamortised.
  close(r.hold.table[4].financingDeduction, r.purchase.financingCosts - annual * 4, 0.01);
  close(r.hold.unamortisedFinancingAtSale, 0, 0.01);
  const claimed = r.hold.table.reduce((a, y) => a + y.financingDeduction, 0);
  close(claimed, r.purchase.financingCosts, 0.01);
});

/* ---------------- passive losses ---------------- */

test('suspended losses accumulate, release at sale, and never touch the gain', () => {
  // Force a loss: high interest expense, modest rent.
  const s = defaultState();
  s.hold.rentMo = 3000;
  s.hold.years = 5;
  s.hold.passiveAllowed = false;
  const r = computeModel(s);

  assert.ok(r.hold.suspendedAtSale > 0, 'the scenario must actually generate a loss');
  // No year with a loss pays negative tax when losses are suspended.
  assert.ok(r.hold.table.every((y) => y.ordinaryTax >= -1e-9));
  // Suspended balance equals the sum of the losses not yet used.
  const totalLoss = r.hold.table.reduce((a, y) => a + Math.max(0, -y.netRental), 0);
  const totalUsed = r.hold.table.reduce((a, y) => a + y.usedSuspended, 0);
  close(r.hold.suspendedAtSale, totalLoss - totalUsed, 0.01);

  // The release is an ordinary-rate benefit, kept apart from gain and recapture.
  close(r.sale.releasedLossTaxBenefit, r.sale.releasedLosses * r.hold.ordinaryRate / 100, 0.01);
  const noLossState = structuredClone(s);
  noLossState.hold.rentMo = 3000;
  const gainOnly = computeModel(noLossState).sale;
  close(gainOnly.taxableGain, r.sale.taxableGain, 0.01);
  close(gainOnly.unrecaptured, r.sale.unrecaptured, 0.01);
  // Gain-side tax is computed without any reference to the suspended losses.
  close(r.sale.totalSaleTax,
    r.sale.fedRecaptureTax + r.sale.fedCapGainsTax + r.sale.niitTax + r.sale.stateGainTax + r.sale.cityGainTax, 0.01);
});

test('when losses are deductible currently, nothing is suspended and the benefit is immediate', () => {
  const s = defaultState();
  s.hold.rentMo = 3000;
  s.hold.passiveAllowed = true;
  const r = computeModel(s);
  assert.equal(r.hold.suspendedAtSale, 0);
  assert.equal(r.sale.releasedLossTaxBenefit, 0);
  assert.ok(r.hold.table.some((y) => y.tax < 0), 'a loss year produces a negative tax, i.e. a benefit');
});

test('suspended losses are not released unless the disposition is fully taxable', () => {
  const s = defaultState();
  s.hold.rentMo = 3000;
  s.profile.fullDisposition = false;
  const r = computeModel(s);
  assert.ok(r.hold.suspendedAtSale > 0);
  assert.equal(r.sale.releasedLosses, 0);
  assert.equal(r.sale.releasedLossTaxBenefit, 0);
});

/* ---------------- gain composition ---------------- */

test('depreciation is recaptured first, then the remainder is long-term gain', () => {
  const r = computeModel(defaultState());
  close(r.sale.unrecaptured + r.sale.capitalGain, r.sale.taxableGain, 0.01);
  assert.ok(r.sale.unrecaptured <= r.sale.accumDep + 1e-6);
  close(r.sale.fedRecaptureTax, r.sale.unrecaptured * 25 / 100, 0.01);
  close(r.sale.fedCapGainsTax, r.sale.capitalGain * 20 / 100, 0.01);
});

test('when the gain is smaller than the depreciation taken, it is ALL recapture', () => {
  const s = simple({ hold: { apprPct: 0, years: 10 } });
  const r = computeModel(s);
  assert.ok(r.sale.taxableGain > 0);
  assert.ok(r.sale.taxableGain < r.sale.accumDep, 'this scenario must gain less than it depreciated');
  close(r.sale.unrecaptured, r.sale.taxableGain, 0.01);
  assert.equal(r.sale.capitalGain, 0);
});

test('a loss on sale produces an ordinary §1231 benefit and no gain tax', () => {
  const s = simple({ hold: { apprPct: -12, years: 3 } });
  const r = computeModel(s);
  assert.ok(r.sale.totalGain < 0);
  assert.equal(r.sale.taxableGain, 0);
  assert.equal(r.sale.totalSaleTax, 0);
  close(r.sale.lossTaxBenefit, r.sale.lossOnSale * r.hold.ordinaryRate / 100, 0.01);
});

/* ---------------- NIIT ---------------- */

test('NIIT applies only to income above the filing-status threshold', () => {
  assert.equal(niitTax(50000, 100000, 'single', 3.8).tax, 0, 'MAGI well below $200k');
  const partial = niitTax(50000, 180000, 'single', 3.8);
  close(partial.base, 30000);
  close(partial.tax, 30000 * 0.038);
  const full = niitTax(50000, 400000, 'single', 3.8);
  close(full.base, 50000);
  close(full.tax, 50000 * 0.038);
  assert.equal(niitTax(50000, 210000, 'mfj', 3.8).base, 10000);
  assert.equal(niitTax(50000, 100000, 'mfs', 3.8).base, 25000);
});

test('the sale NIIT uses filing status, prior MAGI and the gain together', () => {
  const s = defaultState();
  s.profile.filingStatus = 'mfj';
  s.profile.otherMAGI = 100000;
  const r = computeModel(s);
  const expected = Math.max(0, Math.min(r.sale.taxableGain, 100000 + r.sale.taxableGain - 250000));
  close(r.sale.niitBase, expected, 0.01);
  close(r.sale.niitTax, expected * 3.8 / 100, 0.01);
  assert.equal(r.sale.niitThreshold, 250000);
});

test('a low-income investor with a small gain pays no NIIT', () => {
  const s = simple({ profile: { otherMAGI: 0, filingStatus: 'single' }, hold: { apprPct: 0, years: 2 } });
  const r = computeModel(s);
  assert.ok(r.sale.taxableGain < 200000);
  assert.equal(r.sale.niitTax, 0);
});

/* ---------------- residency ---------------- */

test('turning off NYC residency removes the city tax from rent and gain alike', () => {
  const resident = defaultState();
  const nonResident = structuredClone(resident);
  nonResident.profile.nycResident = false;

  const a = computeModel(resident);
  const b = computeModel(nonResident);

  assert.ok(a.sale.cityGainTax > 0);
  assert.equal(b.sale.cityGainTax, 0);
  close(a.hold.ordinaryRate - b.hold.ordinaryRate, 3.876, 1e-9);
  // New York State tax is unaffected — the gain is still New York-source.
  close(a.sale.stateGainTax, b.sale.stateGainTax, 0.01);
  assert.ok(b.sale.netProceeds > a.sale.netProceeds);
});

test('New York State outside the city has no city transfer tax and no city income tax', () => {
  const s = defaultState();
  s.meta.preset = 'us-nys';
  s.purchase.price = 1200000; // above the $1M mansion-tax threshold
  s.rates = structuredClone(PRESETS['us-nys'].rates);
  const r = computeModel(s);
  assert.equal(r.purchase.cityTransfer, 0);
  assert.equal(r.sale.cityGainTax, 0);
  assert.ok(r.purchase.stateTransfer > 0);
  assert.ok(r.purchase.mansionTax > 0, 'the 1% state mansion tax still applies above $1M');
});

/* ---------------- sale proceeds ---------------- */

test('sale proceeds reconcile line by line', () => {
  const r = computeModel(defaultState());
  const s = r.sale;
  close(s.amountRealized, s.salePrice - s.sellingCosts, 0.01);
  close(s.totalGain, s.amountRealized - s.adjustedBasis, 0.01);
  close(s.adjustedBasis, s.costBasis + s.capexTotal - s.accumDep, 0.01);
  close(s.grossProceeds, s.amountRealized - s.loanPayoff, 0.01);
  close(s.netProceeds, s.grossProceeds - s.totalSaleTax + s.releasedLossTaxBenefit + s.lossTaxBenefit, 0.01);
});

test('who pays the transfer tax on the sale changes the seller\'s costs', () => {
  const a = defaultState();
  const b = structuredClone(a);
  b.sale.transferTaxPayer = 'buyer';
  const ra = computeModel(a);
  const rb = computeModel(b);
  assert.ok(ra.sale.sellStateTransfer > 0);
  assert.equal(rb.sale.sellStateTransfer, 0);
  assert.equal(rb.sale.sellCityTransfer, 0);
  close(ra.sale.sellingCosts - rb.sale.sellingCosts,
    ra.sale.sellStateTransfer + ra.sale.sellCityTransfer, 0.01);
  assert.ok(rb.sale.totalGain > ra.sale.totalGain, 'not paying the transfer tax raises the gain');
});

test('an explicit sale price overrides the appreciation projection', () => {
  const s = defaultState();
  s.sale.useOverride = true;
  s.sale.overridePrice = 2000000;
  const r = computeModel(s);
  assert.equal(r.sale.salePrice, 2000000);
  assert.ok(r.sale.usedOverride);
  assert.notEqual(r.sale.projectedPrice, 2000000);
});

/* ---------------- returns ---------------- */

test('ROI and total profit reconcile with the cash-flow stream', () => {
  const r = computeModel(defaultState());
  close(r.returns.totalProfit,
    r.hold.cumAfterTaxCF + r.sale.netProceeds - r.purchase.cashAtClosing, 0.01);
  close(r.returns.roi, r.returns.totalProfit / r.purchase.cashAtClosing * 100, 1e-9);
  const sum = r.returns.cashFlows.reduce((a, b) => a + b, 0);
  close(sum, r.returns.totalProfit, 0.02);
});

test('IRR is the discount rate that zeroes the net present value', () => {
  const r = computeModel(defaultState());
  assert.ok(r.returns.irr !== null);
  close(npv(r.returns.irr, r.returns.cashFlows), 0, 0.5);
});

test('IRR handles textbook cases exactly', () => {
  close(irr([-100, 110]), 0.10, 1e-6);
  close(irr([-1000, 500, 500, 500]), 0.23375, 1e-4);
  assert.equal(irr([-100, -50]), null, 'no positive flow means no IRR');
  assert.equal(irr([100, 50]), null, 'no negative flow means no IRR');
});

test('cap rate, cash-on-cash and equity multiple use the documented bases', () => {
  const r = computeModel(defaultState());
  close(r.returns.capRate, r.hold.year1.noi / r.purchase.price * 100, 1e-9);
  close(r.returns.capRateOnCost, r.hold.year1.noi / r.purchase.costBasis * 100, 1e-9);
  close(r.returns.cashOnCash, r.hold.year1.preTaxCF / r.purchase.cashAtClosing * 100, 1e-9);
  close(r.returns.equityMultiple,
    (r.hold.cumAfterTaxCF + r.sale.netProceeds) / r.purchase.cashAtClosing, 1e-9);
});

/* ---------------- 1031 ---------------- */

test('a 1031 exchange defers exactly the sale tax and forfeits the loss release', () => {
  const r = computeModel(defaultState());
  close(r.exchange.taxesDeferred, r.sale.totalSaleTax, 0.01);
  close(r.exchange.equityIfSold, r.sale.netProceeds, 0.01);
  close(r.exchange.equityIfExchange, r.sale.grossProceeds + r.sale.lossTaxBenefit, 0.01);
  close(r.exchange.extraEquity,
    r.sale.totalSaleTax - r.sale.releasedLossTaxBenefit, 0.01);
  close(r.exchange.carryoverBasis, r.sale.adjustedBasis, 0.01);
});

/* ---------------- determinism & isolation ---------------- */

test('the model is deterministic and never mutates its input', () => {
  const s = defaultState();
  const before = JSON.stringify(s);
  const a = computeModel(s);
  const b = computeModel(s);
  assert.equal(JSON.stringify(s), before, 'computeModel must not touch the state');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'two runs must be identical');
});

test('computeVariant leaves the base scenario untouched', () => {
  const s = defaultState();
  const before = JSON.stringify(s);
  const v = computeVariant(s, { 'hold.years': 15 });
  assert.equal(JSON.stringify(s), before);
  assert.equal(v.results.hold.years, 15);
  assert.equal(computeModel(s).hold.years, 7);
});

test('longer holds accumulate more depreciation and more recapture', () => {
  const five = computeVariant(defaultState(), { 'hold.years': 5 }).results;
  const fifteen = computeVariant(defaultState(), { 'hold.years': 15 }).results;
  assert.ok(fifteen.hold.accumDep > five.hold.accumDep);
  assert.ok(fifteen.sale.unrecaptured >= five.sale.unrecaptured);
});

test('an all-cash purchase has no loan, no interest and no recording tax', () => {
  const s = defaultState();
  s.purchase.downPct = 100;
  const r = computeModel(s);
  assert.equal(r.purchase.loan, 0);
  assert.equal(r.purchase.mortgageRecordingTax, 0);
  assert.equal(r.purchase.points, 0);
  assert.equal(r.hold.year1.interest, 0);
  assert.equal(r.sale.loanPayoff, 0);
  assert.equal(r.hold.annualFinancingDeduction, 0);
});

test('zero-interest financing runs end to end without producing NaN', () => {
  const s = defaultState();
  s.purchase.loanRate = 0;
  const r = computeModel(s);
  assert.ok(Number.isFinite(r.returns.totalProfit));
  assert.ok(Number.isFinite(r.hold.monthlyPaymentAmort));
  assert.equal(r.hold.year1.interest, 0);
});

test('every headline figure is a finite number for the default scenario', () => {
  const r = computeModel(defaultState());
  const checks = [
    r.purchase.cashAtClosing, r.hold.year1.noi, r.returns.capRate, r.returns.cashOnCash,
    r.hold.year1.afterTaxCF, r.sale.salePrice, r.sale.totalSaleTax, r.sale.netProceeds,
    r.returns.totalProfit, r.returns.roi,
  ];
  checks.forEach((v, i) => assert.ok(Number.isFinite(v), `headline figure ${i} is not finite`));
  assert.ok(r.returns.irr === null || Number.isFinite(r.returns.irr));
});
