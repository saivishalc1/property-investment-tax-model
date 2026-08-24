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

import {
  FEDERAL_ORDINARY, FEDERAL_LTCG, NEW_YORK_STATE, NEW_YORK_CITY,
  SECTION_469_ALLOWANCE, TAX_YEAR,
} from './taxTables.js';
import { Money } from './core/money.js';
import { jurisdictionFor, COVERAGE } from './engine/jurisdiction.js';
import { computeRentalTax } from './engine/income.js';
import { computeDisposalTax } from './engine/disposal.js';
import { computeDepreciation } from './engine/depreciation.js';
import { weakestStatus, STATUS } from './core/trace.js';

/** Coerce anything to a finite number; non-numeric input becomes 0. */
export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
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
 * Progressive income tax
 * ------------------------------------------------------------------ *
 * Distinct from the transfer-tax tables above in one important way: income tax
 * is always marginal. A rate table here is [{min, rate}] and every slice of
 * income is taxed at its own rate, never the whole amount at the top rate.
 */

/** Total tax on `income` under a marginal bracket table. */
export function progressiveTax(brackets, income) {
  return bracketTax(brackets, Math.max(0, num(income)), true);
}

/**
 * Tax on `amount` when it is stacked on top of `base` income.
 *
 * This is the number that actually matters for a property decision: not the
 * average rate on all income, and not the top statutory rate, but what this
 * property adds to the bill. A negative `amount` (a deductible loss) correctly
 * returns a negative tax, i.e. a saving.
 */
export function marginalTax(brackets, base, amount) {
  const b = Math.max(0, num(base));
  const withAmount = Math.max(0, b + num(amount));
  return progressiveTax(brackets, withAmount) - progressiveTax(brackets, b);
}

/**
 * Long-term capital gains tax, stacked above ordinary income.
 *
 * Capital gain sits on top of ordinary income when deciding which of the 0/15/20
 * bands it falls in, so a modest earner with a large gain pays across several
 * bands rather than all of it at 20%.
 */
export function longTermGainTax(ltcgBrackets, ordinaryIncome, gain) {
  return marginalTax(ltcgBrackets, ordinaryIncome, gain);
}

/**
 * §469(i) special allowance: how much of a rental loss an actively
 * participating individual may deduct now rather than suspend.
 */
export function section469Allowance(magi, filingStatus) {
  const rule = SECTION_469_ALLOWANCE[filingStatus] || SECTION_469_ALLOWANCE.single;
  if (rule.max === 0) return 0;
  const over = Math.max(0, num(magi) - rule.phaseStart);
  return Math.max(0, rule.max - over * 0.5);
}

/** The rate tables for a filing status, or flat-rate fallbacks. */
export function tablesFor(filingStatus) {
  const fs = FEDERAL_ORDINARY[filingStatus] ? filingStatus : 'single';
  return {
    fedOrdinary: FEDERAL_ORDINARY[fs],
    fedLTCG: FEDERAL_LTCG[fs],
    state: NEW_YORK_STATE[fs],
    city: NEW_YORK_CITY[fs],
  };
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
/**
 * The rule-engine bridge for one run of the model.
 *
 * For a researched market the engine owns every tax figure: it resolves rules
 * by country, region, date and facts, computes in exact decimal, and returns a
 * trace naming the source. For an unresearched market it is INACTIVE and the
 * legacy flat-rate path below still runs — which is why the interface labels
 * those markets unresearched and refuses to present their figures as checked.
 *
 * Money crosses this boundary as a plain number because the surrounding
 * cash-flow machinery is still float-based. The tax arithmetic itself happens
 * in exact decimal inside the engine; only the handover is lossy, and it is
 * lossy at the minor unit rather than through a chain of operations.
 */
function engineBridge(S) {
  const j = jurisdictionFor(S?.meta?.preset);

  /*
   * "Flat" mode is a deliberate professional override: the user has typed their
   * own single marginal rate and wants the model to use it. Running the rule
   * engine anyway would silently discard what they entered, which is worse than
   * a wrong default — it is a control that does nothing.
   *
   * So the engine stands down and the legacy flat-rate path runs. The result is
   * a USER-SUPPLIED ASSUMPTION rather than a checked calculation, which is one
   * of the four statuses this product reports, and the interface says so.
   */
  const overridden = S?.profile?.rateMode === 'flat';
  const active = j.coverage === COVERAGE.MODELLED && !overridden;
  const currency = active ? j.currency : null;

  return {
    active,
    overridden,
    jurisdiction: j,
    currency,
    taxDate: new Date().toISOString().slice(0, 10),
    /*
     * Acquisition and disposal dates.
     *
     * Japan's five-year test is measured at 1 January of the YEAR OF SALE, so
     * the engine needs real dates rather than a hold length. The scenario does
     * not yet collect a completion date, so today is used as the acquisition
     * and the disposal is the hold period after it — an assumption the trace
     * records rather than hides.
     */
    acquisitionDate: new Date().toISOString().slice(0, 10),
    disposalDate: (years) => {
      const d = new Date();
      d.setUTCFullYear(d.getUTCFullYear() + Math.max(1, Math.round(Number(years) || 1)));
      return d.toISOString().slice(0, 10);
    },
    traces: [],
    statuses: [],
    // Pass the full value, not a whole-unit rounding of it. Rounding at this
    // boundary once per year lost about a dollar and a half over a five-year
    // hold, because each year's cents were discarded before the engine saw
    // them. String() gives the shortest round-trip form, which Decimal parses
    // exactly, so the handover loses nothing the float did not already lose.
    money: (n) => Money.of(String(Number(n) || 0), currency),
    toNumber: (m) => (m ? m.amount.toNumberLossy() : 0),
  };
}

export function computeModel(S) {
  const R = S.rates;
  const P = S.purchase;
  const H = S.hold;
  const SA = S.sale;
  const PR = S.profile;

  const engine = engineBridge(S);

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

  /* --- how ordinary income tax is worked out -----------------------
     'brackets' (the default) computes what this property ADDS to the
     investor's bill, by stacking its income on their other income and running
     it through the real 2026 schedules. 'flat' keeps the older behaviour of
     applying one marginal rate to everything, which is what a professional
     overriding the rates by hand is asking for. */
  const useBrackets = PR.rateMode !== 'flat';
  const T = tablesFor(PR.filingStatus);
  // Two conditions, both required: the jurisdiction has to levy a city income
  // tax at all, and this investor has to be resident in it. A preset with no
  // city income tax must never pick one up from the residency toggle.
  const cityApplies = PR.nycResident !== false
    && (num(R.cityOrdinary) > 0 || num(R.cityCapGains) > 0);
  const isNycResident = cityApplies;
  const magiBase = Math.max(0, num(PR.otherMAGI));

  /** Tax this property adds, for an amount of ordinary income (or a loss). */
  const ordinaryTaxOn = (amount, base = magiBase) => {
    if (!useBrackets) return amount * flatOrdinaryRate / 100;
    let t = marginalTax(T.fedOrdinary, base, amount) + marginalTax(T.state, base, amount);
    if (isNycResident) t += marginalTax(T.city, base, amount);
    return t;
  };

  const cityOrdinaryRate = isNycResident ? num(R.cityOrdinary) : 0;
  const flatOrdinaryRate = num(R.fedOrdinary) + num(R.stateOrdinary) + cityOrdinaryRate;
  // Reported for display: the marginal rate this investor actually faces on the
  // next dollar of rental income, rather than the top statutory rate.
  /*
   * The marginal rate on the next unit of rental income.
   *
   * This is a HEADLINE FIGURE — it appears on the deal strip and in the report
   * — and it was computed from ordinaryTaxOn(), which is the legacy US-only
   * path. So it read 29.900% for a British property and 29.900% for a Japanese
   * one, identical because the number was United States federal plus New York
   * State and had nothing to do with either country.
   *
   * Where the engine is active the rate is probed from the engine instead: ask
   * what one more unit of rental income actually costs under that country's
   * law. The probe is a thousand units rather than one so a jurisdiction that
   * rounds its taxable base — Japan truncates to the whole 1,000 yen — does not
   * round the whole probe away to zero.
   */
  const ordinaryRate = (() => {
    if (!engine.active) {
      return useBrackets
        ? (magiBase >= 0 ? ordinaryTaxOn(1000) / 1000 * 100 : flatOrdinaryRate)
        : flatOrdinaryRate;
    }
    const probe = 1000;
    const at = (extra) => engine.toNumber(computeRentalTax(S, {
      netOperatingIncome: engine.money(extra),
      interest: engine.money(0),
      depreciation: engine.money(0),
      otherIncome: engine.money(magiBase),
      on: engine.taxDate,
    }).tax);
    return (at(probe) - at(0)) / probe * 100;
  })();

  // §469(i): an actively participating individual may deduct up to $25,000 of
  // rental losses now, phased out between $100,000 and $150,000 of MAGI.
  const allowanceCap = PR.activeParticipation === false
    ? 0 : section469Allowance(magiBase, PR.filingStatus);

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
    let allowanceUsed = 0;
    let engineRental = null;

    if (engine.active) {
      /*
       * The rule engine owns this figure for a researched market.
       *
       * It is given the components rather than a single "taxable" number
       * because the jurisdictions disagree about what is deductible: the
       * United Kingdom does not deduct mortgage interest at all and grants a
       * basic-rate reducer instead, which cannot be reconstructed from a net
       * figure. Passing the parts is what lets each pack apply its own law.
       */
      engineRental = computeRentalTax(S, {
        netOperatingIncome: engine.money(noi - financingDeduction - usedSuspended),
        interest: engine.money(sch.interest),
        depreciation: engine.money(dep),
        otherIncome: engine.money(magiBase),
        on: engine.taxDate,
      });
      ordinaryTax = engine.toNumber(engineRental.tax);
      allowanceUsed = engine.toNumber(engineRental.allowanceUsed);
      const suspendedThisYear = engine.toNumber(engineRental.suspendedLoss);
      if (suspendedThisYear > 0) {
        suspended += suspendedThisYear;
        taxable = 0;
      } else {
        taxable = Math.max(0, engine.toNumber(engineRental.taxableProfit));
      }
      engine.traces.push(engineRental.trace);
      engine.statuses.push(engineRental.status);
    } else if (taxable > 0) {
      ordinaryTax = ordinaryTaxOn(taxable);
    } else if (taxable < 0) {
      if (H.passiveAllowed) {
        // Losses usable now: a negative tax is a genuine cash benefit.
        ordinaryTax = ordinaryTaxOn(taxable);
      } else {
        // §469(i) first: up to the special allowance is deductible this year,
        // and only what exceeds it is suspended and carried to the sale.
        allowanceUsed = Math.min(-taxable, allowanceCap);
        if (allowanceUsed > 0) ordinaryTax = ordinaryTaxOn(-allowanceUsed);
        suspended += -taxable - allowanceUsed;
        taxable = 0;
      }
    }

    // Net rental income is net investment income under §1411. The engine
    // reports NIIT only on the disposal, so the holding-period charge still
    // comes from here for the United States.
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
      ordinaryTax, allowanceUsed, niitTax: holdNiit.tax, tax, preTaxCF, afterTaxCF,
      dscr: debtService > 0 ? noi / debtService : null,
    });
  }

  const hold = {
    years, ordinaryRate, flatOrdinaryRate, useBrackets, allowanceCap,
    allowanceUsedTotal: table.reduce((a, y) => a + y.allowanceUsed, 0),
    cityOrdinaryRate, depLife, annualDep, annualCapexDep,
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

  /* Three ways to put a number on the exit, which is how the industry actually
     argues about it:
       'appreciation'  grow today's price at an assumed rate
       'price'         a specific figure you have in mind
       'exitCap'       capitalise the final year's NOI at an exit cap rate —
                       the standard underwriting basis, because it values the
                       income rather than the calendar.
     The final year's NOI is the numerator; a buyer purchasing at the end of
     year N is buying year N's income. */
  const finalNoi = table[years - 1].noi;
  const exitCapPct = num(SA.exitCapPct);
  const capBasedPrice = exitCapPct > 0 ? finalNoi / (exitCapPct / 100) : 0;

  let salePrice;
  let saleBasis = SA.saleBasis || (SA.useOverride ? 'price' : 'appreciation');
  if (saleBasis === 'exitCap' && capBasedPrice > 0) salePrice = capBasedPrice;
  else if (saleBasis === 'price' && num(SA.overridePrice) > 0) salePrice = num(SA.overridePrice);
  else { salePrice = projectedPrice; saleBasis = 'appreciation'; }

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

  /* Unrecaptured §1250 gain is taxed at ordinary rates but capped at 25%. The
     statutory 25% is a ceiling, not a flat rate: an investor whose marginal
     rate is below it pays the lower figure. */
  const fedRecaptureTax = useBrackets
    ? Math.min(marginalTax(T.fedOrdinary, magiBase, unrecaptured), unrecaptured * num(R.recapture) / 100)
    : unrecaptured * num(R.recapture) / 100;

  /* Long-term gain stacks above ordinary income AND above the recapture, which
     has already filled part of the ordinary band, so a modest earner with a
     large gain pays across the 0/15/20 bands rather than all of it at 20%. */
  const fedCapGainsTax = useBrackets
    ? longTermGainTax(T.fedLTCG, magiBase + unrecaptured, capitalGain)
    : capitalGain * cgtRate / 100;

  const niitOnSale = R.niitEnabled
    ? niitTax(taxableGain, num(PR.otherMAGI), PR.filingStatus, num(R.niit))
    : { base: 0, tax: 0, threshold: NIIT_THRESHOLDS[PR.filingStatus] || NIIT_THRESHOLDS.single };

  /* New York has no preferential rate for capital gains: the whole gain is
     ordinary income, so it runs through the ordinary schedule stacked on the
     investor's other income. */
  const stateGainTax = useBrackets
    ? marginalTax(T.state, magiBase, taxableGain)
    : taxableGain * num(R.stateCapGains) / 100;
  const cityGainRate = isNycResident ? num(R.cityCapGains) : 0;
  const cityGainTax = !isNycResident ? 0
    : useBrackets ? marginalTax(T.city, magiBase, taxableGain)
    : taxableGain * cityGainRate / 100;

  /*
   * The rule engine owns the disposal tax for a researched market.
   *
   * This is the figure the original defect was worst in: the legacy path above
   * charges United States federal capital gains and NEW YORK STATE income tax
   * on the gain whatever country the property is in, because tablesFor() has no
   * jurisdiction parameter. The engine resolves by country, applies Japan's
   * five-year test measured at 1 January of the year of sale, the United
   * Kingdom's annual exempt amount and 18/24% bands, or the United States split
   * between capped recapture and stacked long-term gain.
   */
  const engineDisposal = engine.active
    ? computeDisposalTax(S, {
      gain: engine.money(taxableGain),
      accumulatedDepreciation: engine.money(accumDep),
      otherIncome: engine.money(magiBase),
      suspendedLosses: engine.money(suspended),
      acquisitionDate: engine.acquisitionDate,
      disposalDate: engine.disposalDate(years),
    })
    : null;

  if (engineDisposal) {
    engine.traces.push(engineDisposal.trace);
    engine.statuses.push(engineDisposal.status);
  }

  /*
   * When the engine supplies the total, it must also supply the breakdown.
   *
   * Taking the total from the engine while leaving the component lines on the
   * legacy figures produces a statement whose parts do not add up to its own
   * total — which a reader checking the arithmetic would rightly treat as a
   * bug in the product.
   */
  const engineSlot = (key) => {
    if (!engineDisposal) return null;
    const parts = engineDisposal.components.filter((c) => c.key === key);
    if (!parts.length) return 0;
    return parts.reduce((a, c) => a + engine.toNumber(c.amount), 0);
  };

  const saleRecaptureTax = engineDisposal ? engineSlot('recapture') : fedRecaptureTax;
  const saleCapGainsTax = engineDisposal
    ? engineSlot('capitalGains') + engineSlot('surtax')
    : fedCapGainsTax;
  const saleNiitTax = engineDisposal ? engineSlot('niit') : niitOnSale.tax;
  const saleStateGainTax = engineDisposal ? engineSlot('state') : stateGainTax;
  const saleCityGainTax = engineDisposal ? engineSlot('city') : cityGainTax;

  const totalSaleTax = saleRecaptureTax + saleCapGainsTax + saleNiitTax
    + saleStateGainTax + saleCityGainTax;

  // §469(g): on a fully taxable disposition to an unrelated party, suspended
  // passive losses are released and deductible against income of any kind.
  // They are a separate ordinary-rate item — they do not net against the gain
  // before the capital-gain and recapture rates are applied.
  const releasedLosses = PR.fullDisposition !== false ? suspended : 0;
  // A deduction, so the benefit is the tax it removes: pass it as a negative
  // amount and flip the sign.
  const releasedLossTaxBenefit = -ordinaryTaxOn(-releasedLosses);

  // A loss on the sale of business/investment realty is an ordinary §1231 loss.
  const lossTaxBenefit = -ordinaryTaxOn(-lossOnSale);

  const loanPayoff = hold.loanBalanceAtSale;
  const grossProceeds = amountRealized - loanPayoff;
  const netProceeds = grossProceeds - totalSaleTax + releasedLossTaxBenefit + lossTaxBenefit;

  const sale = {
    projectedPrice, salePrice, saleBasis, capBasedPrice, finalNoi,
    usedOverride: saleBasis === 'price',
    // What cap rate the assumed exit price actually implies, whichever basis
    // produced it. An exit priced at a sharply lower cap than the going-in
    // figure is an assumption worth arguing about, so it is always shown.
    exitCapRate: salePrice > 0 ? finalNoi / salePrice * 100 : 0,
    sellerPaysTransfer, sellStateTransfer, sellCityTransfer, broker, flipTax,
    sellLegal, sellOther, sellerDuty, sellerDutyRate, cgtRate,
    sellingCosts, amountRealized, adjustedBasis, costBasis, capexTotal, accumDep,
    totalGain, taxableGain, lossOnSale, lossTaxBenefit,
    unrecaptured, capitalGain,
    fedRecaptureTax: saleRecaptureTax, fedCapGainsTax: saleCapGainsTax,
    niitTax: saleNiitTax, niitBase: niitOnSale.base, niitThreshold: niitOnSale.threshold,
    stateGainTax: saleStateGainTax, cityGainTax: saleCityGainTax, cityGainRate, totalSaleTax,
    engineComponents: engineDisposal ? engineDisposal.components : null,
    effectiveRecaptureRate: unrecaptured > 0 ? saleRecaptureTax / unrecaptured * 100 : 0,
    effectiveCapGainsRate: capitalGain > 0 ? saleCapGainsTax / capitalGain * 100 : 0,
    effectiveStateRate: taxableGain > 0 ? saleStateGainTax / taxableGain * 100 : 0,
    effectiveCityRate: taxableGain > 0 ? saleCityGainTax / taxableGain * 100 : 0,
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

  const sqft = Math.max(0, num(P.sqft));
  const units = Math.max(0, Math.round(num(P.units)));

  const returns = {
    cashInvested: cashAtClosing,
    pricePerSqft: sqft > 0 ? price / sqft : null,
    pricePerUnit: units > 0 ? price / units : null,
    salePricePerSqft: sqft > 0 ? salePrice / sqft : null,
    salePricePerUnit: units > 0 ? salePrice / units : null,
    rentPerSqftYr: sqft > 0 ? year1.grossRent / sqft : null,
    exitCapRate: salePrice > 0 ? finalNoi / salePrice * 100 : 0,
    // Average debt-service coverage over the hold, the figure a lender asks for.
    avgDscr: (() => {
      const yrs = table.filter((y) => y.debtService > 0);
      return yrs.length ? yrs.reduce((a, y) => a + y.noi / y.debtService, 0) / yrs.length : null;
    })(),
    minDscr: (() => {
      const yrs = table.filter((y) => y.debtService > 0).map((y) => y.noi / y.debtService);
      return yrs.length ? Math.min(...yrs) : null;
    })(),
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

  /* Sources and uses: every dollar coming in and every dollar going out at
     close, which must balance. Standard on any real estate closing summary. */
  const uses = {
    purchasePrice: price,
    acquisitionCosts: basisCosts,
    financingCosts,
    total: price + basisCosts + financingCosts,
  };
  const sources = {
    loanProceeds: loan,
    equity: cashAtClosing,
    total: loan + cashAtClosing,
  };
  const sourcesAndUses = { uses, sources, balanced: Math.abs(uses.total - sources.total) < 0.01 };

  return {
    purchase, hold, sale, returns, exchange, sourcesAndUses,
    meta: {
      ordinaryRate, cgtRate, depLife, taxYear: TAX_YEAR, useBrackets,
      /*
       * Where the tax figures above actually came from.
       *
       * `engine: true` means every tax number was resolved from the versioned
       * rule packs by country, region, date and facts. `false` means this is a
       * market with no researched pack and the legacy flat-rate path ran, which
       * is why the interface labels it unresearched.
       */
      engine: engine.active,
      /** True when the user overrode the rules with their own flat rate. */
      ratesOverridden: engine.overridden,
      jurisdiction: engine.jurisdiction,
      engineStatus: engine.overridden
        ? STATUS.ASSUMPTION
        : (engine.statuses.length ? weakestStatus(engine.statuses) : STATUS.UNSUPPORTED),
      engineTraces: engine.traces,
    },
  };
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
