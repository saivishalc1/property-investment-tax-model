/**
 * calculations.js — pure, deterministic calculation engine.
 *
 * No DOM access, no storage, no side effects. Every rate the engine uses comes
 * from `state.rates`, so the same code can be pointed at any jurisdiction.
 *
 * All money is in whole currency units. All rates are expressed as percentages
 * (6.85 means 6.85%), never as decimals, because that is how they are entered.
 *
 * Nothing in this file is tax advice. See README.md § Methodology.
 */

/** Coerce anything to a finite number; non-numeric input becomes 0. */
export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round to cents so repeated arithmetic cannot drift. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Bracket tables
 * ------------------------------------------------------------------ *
 * A table is [{ min, rate }] sorted ascending by `min`, rate in percent.
 *
 * Two entirely different regimes exist in the wild and the difference is
 * worth real money:
 *
 *   WHOLE-PRICE ("cliff"). The rate of the highest bracket whose `min` is
 *   reached applies to the ENTIRE value. New York's mansion tax and the NYC
 *   Real Property Transfer Tax both work this way — one dollar over a
 *   threshold re-rates the whole purchase price.
 *
 *   MARGINAL ("slice"). Each slice of value is taxed at its own bracket rate,
 *   the way UK SDLT or US income tax works.
 *
 * `marginal` selects between them. Getting this backwards is the single
 * largest source of error in transaction-tax estimates, so both paths are
 * unit-tested against published worked examples.
 */

/** Rate (percent) of the highest bracket reached by `value`. */
export function bracketRate(table, value) {
  if (!Array.isArray(table) || table.length === 0) return 0;
  let rate = 0;
  for (const b of table) {
    if (value >= num(b.min)) rate = num(b.rate);
    else break;
  }
  return rate;
}

/** Tax due on `value` under `table`. `marginal` switches slice-by-slice mode. */
export function bracketTax(table, value, marginal) {
  if (!Array.isArray(table) || table.length === 0 || value <= 0) return 0;
  if (!marginal) return value * bracketRate(table, value) / 100;
  let tax = 0;
  for (let i = 0; i < table.length; i++) {
    const lo = num(table[i].min);
    const hi = i + 1 < table.length ? num(table[i + 1].min) : Infinity;
    if (value > lo) tax += (Math.min(value, hi) - lo) * num(table[i].rate) / 100;
  }
  return tax;
}

/* ------------------------------------------------------------------ *
 * Amortization
 * ------------------------------------------------------------------ */

/**
 * Level-payment mortgage amortization, reported by year.
 *
 * Handles three cases the naive formula gets wrong:
 *   - Zero interest. r = 0 makes the annuity formula divide by zero, so the
 *     payment is simply principal / amortizing months.
 *   - Interest-only periods. During the IO months the payment is interest
 *     only and the balance does not move. The amortizing payment is then
 *     sized to clear the ORIGINAL principal over the remaining months, which
 *     is what a real IO-then-amortizing loan does, so the payment steps up
 *     at the transition.
 *   - Hold periods longer than the loan term. Once the balance reaches zero
 *     every later year reports zeros rather than negative interest.
 *
 * @returns {{ monthlyPaymentIO:number, monthlyPaymentAmort:number,
 *             ioMonths:number, termMonths:number, schedule:Array }}
 */
export function amortize(principal, annualRatePct, termYears, years, ioYears) {
  const p0 = Math.max(0, num(principal));
  const r = num(annualRatePct) / 100 / 12;
  const termMonths = Math.max(1, Math.round(num(termYears) * 12));
  const ioMonths = Math.max(0, Math.min(termMonths, Math.round(num(ioYears) * 12)));
  const amortMonths = Math.max(1, termMonths - ioMonths);

  const monthlyPaymentAmort = p0 === 0
    ? 0
    : (r > 0 ? p0 * r / (1 - Math.pow(1 + r, -amortMonths)) : p0 / amortMonths);
  const monthlyPaymentIO = p0 * r;

  let bal = p0;
  const schedule = [];
  const nYears = Math.max(1, Math.round(num(years)));

  for (let y = 1; y <= nYears; y++) {
    let interest = 0;
    let principalPaid = 0;
    for (let m = 1; m <= 12; m++) {
      const elapsed = (y - 1) * 12 + m;
      if (elapsed > termMonths || bal <= 1e-9) break;
      const i = bal * r;
      interest += i;
      if (elapsed > ioMonths) {
        let pr = monthlyPaymentAmort - i;
        if (pr > bal) pr = bal;
        if (pr < 0) pr = 0;
        principalPaid += pr;
        bal -= pr;
      }
    }
    schedule.push({
      year: y,
      interest,
      principal: principalPaid,
      payment: interest + principalPaid,
      balance: Math.max(bal, 0),
    });
  }
  return { monthlyPaymentIO, monthlyPaymentAmort, ioMonths, termMonths, schedule };
}

/* ------------------------------------------------------------------ *
 * Discounting
 * ------------------------------------------------------------------ */

/** Net present value of a cash-flow array where cf[0] occurs at t = 0. */
export function npv(rate, cf) {
  return cf.reduce((s, c, t) => s + c / Math.pow(1 + rate, t), 0);
}

/**
 * IRR by bisection. Deterministic and bounded: 200 halvings of [-0.9999, 10]
 * resolve far beyond double precision, and the answer is verified before it is
 * returned. Returns null when no sign change exists in the bracket, which is
 * the honest answer for a cash-flow stream that never turns positive.
 */
export function irr(cf) {
  if (!Array.isArray(cf) || cf.length < 2) return null;
  const hasPos = cf.some((c) => c > 0);
  const hasNeg = cf.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null;

  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo, cf);
  let fHi = npv(hi, cf);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cf);
    if (fMid === 0) return mid;
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  const out = (lo + hi) / 2;
  return Number.isFinite(out) ? out : null;
}

/* ------------------------------------------------------------------ *
 * Depreciation helpers
 * ------------------------------------------------------------------ */

/**
 * IRS mid-month convention (§168(d)(2)): real property is treated as placed in
 * service, or disposed of, at the midpoint of the month. The first year gets
 * (12 - month + 0.5) / 12 of a full year.
 */
export function midMonthPlacedFraction(month) {
  const m = Math.min(12, Math.max(1, Math.round(num(month) || 1)));
  return (12 - m + 0.5) / 12;
}

/** Mid-month convention on disposition: (month - 0.5) / 12 of a full year. */
export function midMonthDisposalFraction(month) {
  const m = Math.min(12, Math.max(1, Math.round(num(month) || 12)));
  return (m - 0.5) / 12;
}

/* ------------------------------------------------------------------ *
 * NIIT
 * ------------------------------------------------------------------ */

export const NIIT_THRESHOLDS = { single: 200000, mfj: 250000, mfs: 125000 };

/**
 * Net Investment Income Tax (§1411). 3.8% of the LESSER of net investment
 * income and the excess of MAGI over the filing-status threshold. Because the
 * thresholds are not indexed, they are hard constants, not rates.
 *
 * @param {number} investmentIncome net investment income for the year
 * @param {number} otherMAGI        MAGI excluding this property
 * @param {string} filingStatus     'single' | 'mfj' | 'mfs'
 * @param {number} ratePct          statutory rate, normally 3.8
 */
export function niitTax(investmentIncome, otherMAGI, filingStatus, ratePct) {
  const nii = Math.max(0, num(investmentIncome));
  if (nii === 0) return { base: 0, tax: 0, threshold: NIIT_THRESHOLDS[filingStatus] || NIIT_THRESHOLDS.single };
  const threshold = NIIT_THRESHOLDS[filingStatus] || NIIT_THRESHOLDS.single;
  const magi = num(otherMAGI) + nii;
  const base = Math.max(0, Math.min(nii, magi - threshold));
  return { base, tax: base * num(ratePct) / 100, threshold };
}

/* ------------------------------------------------------------------ *
 * Main model
 * ------------------------------------------------------------------ */

/**
 * Run the full model.
 *
 * @param {object} S scenario state (see storage.js for the schema)
 * @returns {object} results — purchase, hold, sale, returns, exchange
 */
export function computeModel(S) {
  const R = S.rates;
  const P = S.purchase;
  const H = S.hold;
  const SA = S.sale;
  const PR = S.profile;

  const isComm = P.propType === 'commercial';
  const isCoop = P.propType === 'coop';
  const price = Math.max(0, num(P.price));
  const marginal = !!R.marginalBrackets;

  /* ============================ 1. PURCHASE ============================ */

  const stateTransfer = bracketTax(isComm ? R.stateTransferComm : R.stateTransferRes, price, marginal);
  const cityTransfer = bracketTax(isComm ? R.cityTransferComm : R.cityTransferRes, price, marginal);
  // Buyer-side duties (NY mansion tax, Singapore ABSD) never apply on a sale.
  const mansionTax = isComm ? 0 : bracketTax(R.mansion, price, marginal);

  const loan = Math.max(0, price * (1 - num(P.downPct) / 100));
  const downPayment = price - loan;

  // Co-op shares are personal property, so there is no mortgage to record and
  // no title policy — the lender files a UCC-1 instead.
  let mrtRate = isComm ? num(R.mrtCommercial) : bracketRate(R.mrtResidential, loan);
  if (isCoop && R.coopExemptFromMRT) mrtRate = 0;
  const mortgageRecordingTax = loan * mrtRate / 100;

  const points = loan * num(P.pointsPct) / 100;
  const titleIns = (isCoop && R.coopExemptFromTitle) ? 0 : price * num(P.titlePct) / 100;
  const buyLegal = num(P.legal);
  const buyInspection = num(P.inspection);
  const buyOther = num(P.otherBuy);

  // Who actually writes the cheque for the transfer tax at closing. In New York
  // the seller pays by default; new construction and sponsor sales routinely
  // shift it to the buyer, in which case it capitalises into the buyer's basis.
  const buyerPaysTransfer = P.transferTaxPayer === 'buyer';
  const buyerTransfer = buyerPaysTransfer ? stateTransfer + cityTransfer : 0;

  // Acquisition costs capitalise into basis. Financing costs do not — they are
  // amortised over the life of the loan instead (§461(g), Reg. §1.446-5).
  const basisCosts = mansionTax + titleIns + buyLegal + buyInspection + buyOther + buyerTransfer;
  const financingCosts = mortgageRecordingTax + points;

  const costBasis = price + basisCosts;
  const landValue = costBasis * num(P.landPct) / 100;
  const depreciableBasis = Math.max(0, costBasis - landValue);
  const closingCosts = basisCosts + financingCosts;
  const cashAtClosing = downPayment + closingCosts;

  const purchase = {
    price, downPayment, loan, ltv: price > 0 ? loan / price * 100 : 0,
    stateTransfer, cityTransfer, mansionTax, buyerPaysTransfer, buyerTransfer,
    mortgageRecordingTax, mrtRate, points, titleIns, buyLegal, buyInspection, buyOther,
    basisCosts, financingCosts, closingCosts, costBasis, landValue, depreciableBasis,
    cashAtClosing,
  };

  /* ============================ 2. HOLD ============================ */

  const years = Math.max(1, Math.round(num(H.years)));
  const am = amortize(loan, num(P.loanRate), num(P.loanTermYrs), years, num(P.ioYears));

  const depLife = Math.max(1, num(isComm ? R.depLifeCommercial : R.depLifeResidential));
  const annualDep = depreciableBasis / depLife;
  const placedFraction = midMonthPlacedFraction(PR.serviceMonth);
  const saleFraction = midMonthDisposalFraction(SA.saleMonth);

  // Capital improvements are building improvements: they carry no land
  // component, so the whole amount is depreciable over a fresh recovery
  // period beginning in the year they are placed in service.
  const capexTotal = Math.max(0, num(H.capexTotal));
  const capexYear = Math.min(years, Math.max(1, Math.round(num(PR.capexYear) || 1)));
  const capexPlacedFraction = midMonthPlacedFraction(PR.capexMonth);
  const annualCapexDep = capexTotal / depLife;
  const capexSpread = H.capexTiming === 'spread';

  // Loan costs amortise straight-line over the loan term and stop when the
  // term ends. Whatever is left unamortised is deducted in the year of sale.
  const loanTermYears = Math.max(1, num(P.loanTermYrs));
  const annualFinancingDeduction = loan > 0 ? financingCosts / loanTermYears : 0;

  const cityOrdinaryRate = PR.nycResident === false ? 0 : num(R.cityOrdinary);
  const ordinaryRate = num(R.fedOrdinary) + num(R.stateOrdinary) + cityOrdinaryRate;

  let accumDep = 0;
  let suspended = 0;
  let cumAfterTaxCF = 0;
  let cumPreTaxCF = 0;
  let cumHoldTax = 0;
  let cumCapexCash = 0;
  let financingAmortised = 0;
  const table = [];

  for (let y = 1; y <= years; y++) {
    const gr = Math.pow(1 + num(H.rentGrowthPct) / 100, y - 1);
    const og = Math.pow(1 + num(H.opexGrowthPct) / 100, y - 1);

    const grossRent = num(H.rentMo) * 12 * gr + num(H.otherIncomeYr) * gr;
    const vacancy = grossRent * num(H.vacancyPct) / 100;
    const egi = grossRent - vacancy;

    const propTax = num(H.propTaxYr) * og;
    const insurance = num(H.insuranceYr) * og;
    const hoa = num(H.hoaMo) * 12 * og;
    const utilities = num(H.utilitiesYr) * og;
    const otherOpex = num(H.otherOpexYr) * og;
    const maint = grossRent * num(H.maintPct) / 100;
    const mgmt = egi * num(H.mgmtPct) / 100;
    const opex = propTax + insurance + hoa + utilities + otherOpex + maint + mgmt;

    const noi = egi - opex;
    const sch = am.schedule[y - 1] || { interest: 0, principal: 0, balance: 0, payment: 0 };

    // --- depreciation -------------------------------------------------
    // Mid-month in the first year, mid-month again in the year of sale.
    let buildingFactor = 1;
    if (y === 1) buildingFactor = placedFraction;
    if (y === years) buildingFactor = Math.min(buildingFactor, y === 1 ? Math.min(placedFraction, saleFraction) : saleFraction);
    if (y > depLife) buildingFactor = 0;
    const baseDep = annualDep * buildingFactor;

    let capexFactor = 0;
    if (y > capexYear) capexFactor = 1;
    else if (y === capexYear) capexFactor = capexPlacedFraction;
    if (y === years && capexFactor > 0) capexFactor = Math.min(capexFactor, saleFraction);
    const capexDep = annualCapexDep * capexFactor;

    const depCap = Math.max(0, depreciableBasis + capexTotal - accumDep);
    const dep = Math.min(baseDep + capexDep, depCap);
    accumDep += dep;

    // --- loan cost amortisation ---------------------------------------
    let financingDeduction = 0;
    if (y <= loanTermYears) {
      financingDeduction = Math.min(annualFinancingDeduction, Math.max(0, financingCosts - financingAmortised));
    }
    if (y === years) {
      // Disposition accelerates the remaining unamortised balance.
      financingDeduction = Math.max(0, financingCosts - financingAmortised);
    }
    financingAmortised += financingDeduction;

    // --- capital improvement cash outlay ------------------------------
    const capexCash = capexSpread ? capexTotal / years : (y === capexYear ? capexTotal : 0);
    cumCapexCash += capexCash;

    // --- taxable rental result ----------------------------------------
    const netRental = noi - sch.interest - dep - financingDeduction;
    let taxable = netRental;
    let usedSuspended = 0;

    if (taxable > 0 && suspended > 0) {
      usedSuspended = Math.min(suspended, taxable);
      taxable -= usedSuspended;
      suspended -= usedSuspended;
    }

    let ordinaryTax = 0;
    if (taxable > 0) {
      ordinaryTax = taxable * ordinaryRate / 100;
    } else if (taxable < 0) {
      if (H.passiveAllowed) {
        // Losses usable now: a negative tax is a genuine cash benefit.
        ordinaryTax = taxable * ordinaryRate / 100;
      } else {
        // §469: suspended, carried forward, released on full disposition.
        suspended += -taxable;
        taxable = 0;
      }
    }

    // Net rental income is net investment income under §1411.
    const holdNiit = R.niitEnabled && PR.niitOnRental !== false && taxable > 0
      ? niitTax(taxable, num(PR.otherMAGI), PR.filingStatus, num(R.niit))
      : { base: 0, tax: 0 };

    const tax = ordinaryTax + holdNiit.tax;
    cumHoldTax += tax;

    const debtService = sch.payment;
    const preTaxCF = noi - debtService - capexCash;
    const afterTaxCF = preTaxCF - tax;
    cumPreTaxCF += preTaxCF;
    cumAfterTaxCF += afterTaxCF;

    table.push({
      year: y, grossRent, vacancy, egi, propTax, insurance, hoa, utilities, otherOpex,
      maint, mgmt, opex, noi,
      interest: sch.interest, principalPaid: sch.principal, debtService, balance: sch.balance,
      dep, accumDep, depFactor: buildingFactor, financingDeduction,
      capexCash, netRental, taxable, usedSuspended, suspendedBalance: suspended,
      ordinaryTax, niitTax: holdNiit.tax, tax, preTaxCF, afterTaxCF,
      dscr: debtService > 0 ? noi / debtService : null,
    });
  }

  const hold = {
    years, ordinaryRate, cityOrdinaryRate, depLife, annualDep, annualCapexDep,
    placedFraction, saleFraction, capexYear, capexTotal, capexSpread,
    annualFinancingDeduction, financingAmortised,
    unamortisedFinancingAtSale: Math.max(0, financingCosts - financingAmortised),
    monthlyPaymentIO: am.monthlyPaymentIO, monthlyPaymentAmort: am.monthlyPaymentAmort,
    ioMonths: am.ioMonths,
    accumDep, suspendedAtSale: suspended, cumAfterTaxCF, cumPreTaxCF, cumHoldTax,
    cumCapexCash, loanBalanceAtSale: table[years - 1].balance,
    year1: table[0], table,
  };

  /* ============================ 3. SALE ============================ */

  const projectedPrice = price * Math.pow(1 + num(H.apprPct) / 100, years);
  const salePrice = (SA.useOverride && num(SA.overridePrice) > 0)
    ? num(SA.overridePrice)
    : projectedPrice;

  // Holding-period regimes: Japan's five-year line, Germany's ten-year
  // exemption, Singapore's seller's stamp duty. NY has neither, so both
  // tables are empty for the US presets and the flat rates apply.
  const cgtRate = (Array.isArray(R.cgtByYears) && R.cgtByYears.length)
    ? bracketRate(R.cgtByYears, years) : num(R.fedLTCG);
  const sellerDutyRate = (Array.isArray(R.sellerDutyByYears) && R.sellerDutyByYears.length)
    ? bracketRate(R.sellerDutyByYears, years) : 0;
  const sellerDuty = salePrice * sellerDutyRate / 100;

  const sellerPaysTransfer = SA.transferTaxPayer !== 'buyer';
  const sellStateTransfer = sellerPaysTransfer
    ? bracketTax(isComm ? R.stateTransferComm : R.stateTransferRes, salePrice, marginal) : 0;
  const sellCityTransfer = sellerPaysTransfer
    ? bracketTax(isComm ? R.cityTransferComm : R.cityTransferRes, salePrice, marginal) : 0;

  const broker = salePrice * num(SA.brokerPct) / 100;
  const flipTax = isCoop ? salePrice * num(SA.flipTaxPct) / 100 : 0;
  const sellLegal = num(SA.sellLegal);
  const sellOther = num(SA.otherSell);
  const sellingCosts = sellStateTransfer + sellCityTransfer + broker + flipTax
    + sellLegal + sellOther + sellerDuty;

  const amountRealized = salePrice - sellingCosts;
  const adjustedBasis = costBasis + capexTotal - accumDep;
  const totalGain = amountRealized - adjustedBasis;

  const taxableGain = Math.max(0, totalGain);
  const lossOnSale = Math.max(0, -totalGain);

  // Unrecaptured §1250 gain is capped at accumulated depreciation and is taken
  // out of the gain FIRST; only what is left is long-term capital gain.
  const unrecaptured = Math.min(accumDep, taxableGain);
  const capitalGain = Math.max(0, taxableGain - unrecaptured);

  const fedRecaptureTax = unrecaptured * num(R.recapture) / 100;
  const fedCapGainsTax = capitalGain * cgtRate / 100;

  const niitOnSale = R.niitEnabled
    ? niitTax(taxableGain, num(PR.otherMAGI), PR.filingStatus, num(R.niit))
    : { base: 0, tax: 0, threshold: NIIT_THRESHOLDS[PR.filingStatus] || NIIT_THRESHOLDS.single };

  const stateGainTax = taxableGain * num(R.stateCapGains) / 100;
  const cityGainRate = PR.nycResident === false ? 0 : num(R.cityCapGains);
  const cityGainTax = taxableGain * cityGainRate / 100;

  const totalSaleTax = fedRecaptureTax + fedCapGainsTax + niitOnSale.tax + stateGainTax + cityGainTax;

  // §469(g): on a fully taxable disposition to an unrelated party, suspended
  // passive losses are released and deductible against income of any kind.
  // They are a separate ordinary-rate item — they do not net against the gain
  // before the capital-gain and recapture rates are applied.
  const releasedLosses = PR.fullDisposition !== false ? suspended : 0;
  const releasedLossTaxBenefit = releasedLosses * ordinaryRate / 100;

  // A loss on the sale of business/investment realty is an ordinary §1231 loss.
  const lossTaxBenefit = lossOnSale * ordinaryRate / 100;

  const loanPayoff = hold.loanBalanceAtSale;
  const grossProceeds = amountRealized - loanPayoff;
  const netProceeds = grossProceeds - totalSaleTax + releasedLossTaxBenefit + lossTaxBenefit;

  const sale = {
    projectedPrice, salePrice, usedOverride: !!(SA.useOverride && num(SA.overridePrice) > 0),
    sellerPaysTransfer, sellStateTransfer, sellCityTransfer, broker, flipTax,
    sellLegal, sellOther, sellerDuty, sellerDutyRate, cgtRate,
    sellingCosts, amountRealized, adjustedBasis, costBasis, capexTotal, accumDep,
    totalGain, taxableGain, lossOnSale, lossTaxBenefit,
    unrecaptured, capitalGain,
    fedRecaptureTax, fedCapGainsTax,
    niitTax: niitOnSale.tax, niitBase: niitOnSale.base, niitThreshold: niitOnSale.threshold,
    stateGainTax, cityGainTax, cityGainRate, totalSaleTax,
    releasedLosses, releasedLossTaxBenefit,
    loanPayoff, grossProceeds, netProceeds,
    effectiveGainRate: taxableGain > 0 ? totalSaleTax / taxableGain * 100 : 0,
  };

  /* ============================ 4. RETURNS ============================ */

  const cashFlows = [-cashAtClosing];
  for (let y = 1; y <= years; y++) {
    cashFlows.push(table[y - 1].afterTaxCF + (y === years ? netProceeds : 0));
  }
  const preTaxFlows = [-cashAtClosing];
  for (let y = 1; y <= years; y++) {
    preTaxFlows.push(table[y - 1].preTaxCF + (y === years ? grossProceeds : 0));
  }

  const totalProfit = cumAfterTaxCF + netProceeds - cashAtClosing;
  const year1 = table[0];

  const returns = {
    cashInvested: cashAtClosing,
    totalProfit,
    roi: cashAtClosing > 0 ? totalProfit / cashAtClosing * 100 : 0,
    annualisedRoi: cashAtClosing > 0 && years > 0
      ? (Math.pow(Math.max(0, (cashAtClosing + totalProfit) / cashAtClosing), 1 / years) - 1) * 100
      : 0,
    irr: irr(cashFlows),
    preTaxIrr: irr(preTaxFlows),
    equityMultiple: cashAtClosing > 0 ? (cumAfterTaxCF + netProceeds) / cashAtClosing : 0,
    capRate: price > 0 ? year1.noi / price * 100 : 0,
    capRateOnCost: costBasis > 0 ? year1.noi / costBasis * 100 : 0,
    cashOnCash: cashAtClosing > 0 ? year1.preTaxCF / cashAtClosing * 100 : 0,
    afterTaxCashOnCash: cashAtClosing > 0 ? year1.afterTaxCF / cashAtClosing * 100 : 0,
    grm: year1.grossRent > 0 ? price / year1.grossRent : null,
    totalTaxPaid: cumHoldTax + totalSaleTax - releasedLossTaxBenefit - lossTaxBenefit
      + mansionTax + mortgageRecordingTax + buyerTransfer
      + sellStateTransfer + sellCityTransfer + sellerDuty + flipTax,
    transactionTaxes: mansionTax + mortgageRecordingTax + buyerTransfer
      + sellStateTransfer + sellCityTransfer + sellerDuty + flipTax,
    cashFlows, preTaxFlows,
  };

  /* ============================ 5. 1031 EXCHANGE ============================ */

  // A §1031 like-kind exchange defers the federal and state tax on the gain.
  // It does NOT release suspended passive losses, and it does not avoid the
  // transfer taxes or selling costs — those are already inside grossProceeds.
  const ltv = price > 0 ? loan / price : 0;
  const equityIfSold = netProceeds;
  const equityIfExchange = grossProceeds + lossTaxBenefit; // taxes deferred, losses stay suspended
  const exchange = {
    taxesDeferred: totalSaleTax,
    lostLossBenefit: releasedLossTaxBenefit,
    equityIfSold,
    equityIfExchange,
    extraEquity: equityIfExchange - equityIfSold,
    buyingPowerSold: ltv < 1 ? equityIfSold / (1 - ltv) : equityIfSold,
    buyingPowerExchange: ltv < 1 ? equityIfExchange / (1 - ltv) : equityIfExchange,
    ltv: ltv * 100,
    carryoverBasis: adjustedBasis,
    deferredGain: taxableGain,
    deferredRecapture: unrecaptured,
  };

  return { purchase, hold, sale, returns, exchange, meta: { ordinaryRate, cgtRate, depLife } };
}

/**
 * Re-run the model with a set of overrides applied to a deep copy of the
 * state. Used by every comparison view so that comparisons can never mutate
 * the user's scenario.
 *
 * @param {object} S      base state
 * @param {object} patch  { 'hold.years': 10, 'purchase.downPct': 40 }
 */
export function computeVariant(S, patch) {
  const copy = structuredClone(S);
  for (const [path, value] of Object.entries(patch || {})) {
    const keys = path.split('.');
    const last = keys.pop();
    let node = copy;
    for (const k of keys) {
      if (node[k] == null || typeof node[k] !== 'object') return null;
      node = node[k];
    }
    node[last] = value;
  }
  return { state: copy, results: computeModel(copy) };
}
