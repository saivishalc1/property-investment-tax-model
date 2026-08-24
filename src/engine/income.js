/**
 * income.js — tax on a year of rental operation, per jurisdiction.
 *
 * The three markets do not merely use different rates. They disagree about
 * what is deductible, which is a structural difference no rate table can
 * express:
 *
 *   United States  Mortgage interest and depreciation are both deducted from
 *                  rental income. A loss is passive under section 469: it is
 *                  suspended and carried to the disposal, except for up to
 *                  $25,000 under section 469(i) for an actively participating
 *                  individual, phased out between $100,000 and $150,000 of MAGI.
 *
 *   United Kingdom Since April 2020 an individual landlord gets NO DEDUCTION
 *                  for mortgage interest against residential property income.
 *                  They get a basic-rate TAX REDUCER instead: 20% of the lower
 *                  of finance costs, property profits, and adjusted total
 *                  income. For a higher-rate taxpayer that is worth half what a
 *                  deduction would be, and the old model deducted interest in
 *                  full — over-relieving every leveraged UK higher-rate
 *                  investor, every year. This is the single most consequential
 *                  UK-specific rule in the product.
 *
 *   Japan          Interest and depreciation are deducted. The result is taxed
 *                  at the national progressive rates, plus a 2.1% reconstruction
 *                  surtax ON THE TAX, plus local inhabitant tax.
 *
 * Every figure is exact and carries a trace naming the rule it came from.
 */

import { Decimal, ROUND } from '../core/decimal.js';
import { Money, sumMoney } from '../core/money.js';
import { trace, STATUS, weakestStatus } from '../core/trace.js';
import { registry } from '../rules/index.js';
import { evaluateRule, marginalCharge } from '../rules/evaluate.js';
import { CATEGORY, COMPONENT, OWNERSHIP } from '../rules/schema.js';
import { jurisdictionFor, COVERAGE } from './jurisdiction.js';
import { factsFromScenario } from './transactions.js';
import { UK_CONSTANTS } from '../rules/jurisdictions/uk.js';
import { SECTION_469_ALLOWANCE } from '../rules/jurisdictions/us-ny.js';
import { RECONSTRUCTION_SURTAX, JP_CONSTANTS } from '../rules/jurisdictions/jp.js';

/**
 * Tax on one year of rental operation.
 *
 * @param {object} scenario
 * @param {object} year
 * @param {Money}  year.netOperatingIncome  rent less operating expenses
 * @param {Money}  year.interest            mortgage interest for the year
 * @param {Money}  year.depreciation        allowance for the year (nil where none)
 * @param {Money}  year.otherIncome         the investor's other taxable income
 * @param {string} on ISO date inside the tax year
 */
export function computeRentalTax(scenario, { netOperatingIncome, interest, depreciation, otherIncome, on }) {
  const j = jurisdictionFor(scenario?.meta?.preset);
  const currency = netOperatingIncome.currency;

  if (j.coverage !== COVERAGE.MODELLED) {
    return unsupportedResult(currency, j.reason);
  }

  const facts = factsFromScenario(scenario);
  const ctx = { scenario, j, facts, on, currency, netOperatingIncome, interest, depreciation, otherIncome };

  if (j.country === 'GB') return unitedKingdom(ctx);
  if (j.country === 'JP') return japan(ctx);
  if (j.country === 'US') return unitedStates(ctx);
  return unsupportedResult(currency, `No rental income rule for ${j.country}.`);
}

function unsupportedResult(currency, reason) {
  const zero = Money.zero(currency);
  return {
    taxableProfit: zero,
    tax: zero,
    reliefs: zero,
    allowanceUsed: zero,
    suspendedLoss: zero,
    status: STATUS.UNSUPPORTED,
    trace: trace('income', 'Tax on rental income')
      .status(STATUS.UNSUPPORTED).formula('not computed').warn(reason).result(zero).build(),
  };
}

/* ------------------------------------------------------------------ *
 * United Kingdom
 * ------------------------------------------------------------------ */

function unitedKingdom(ctx) {
  const { currency, netOperatingIncome, interest, otherIncome, on, facts } = ctx;
  const zero = Money.zero(currency);
  const t = trace('income.gb', 'UK tax on property income');

  const rule = registry.resolve({
    country: 'GB', region: 'GB-EWNI', category: CATEGORY.INCOME_TAX, on,
    facts: { ownership: OWNERSHIP.INDIVIDUAL },
  }).rule;
  if (!rule) return unsupportedResult(currency, `No UK income tax rule in force on ${on}.`);

  // Interest is NOT deductible. Property profit is computed without it.
  const profit = netOperatingIncome.clampLow();
  t.formula('tax on property profit (interest NOT deducted), less a basic-rate finance-cost reducer')
    .input('netOperatingIncome', netOperatingIncome)
    .input('financeCosts', interest)
    .line({
      label: 'Property profit',
      detail: 'rent less allowable expenses. Mortgage interest is NOT an allowable expense for an individual landlord.',
      amount: profit,
    });

  if (profit.isZero() && netOperatingIncome.isNegative()) {
    t.line({ label: 'Loss carried forward', detail: 'a UK property loss is carried against future property profits', amount: netOperatingIncome });
  }

  // Tax on the profit, stacked on the investor's other taxable income.
  const { amount: grossTax, trace: taxTrace } = marginalCharge(rule, otherIncome, profit);
  t.child(taxTrace).line({ label: 'Income tax on the profit', amount: grossTax });

  /*
   * The finance-cost tax reducer (ITTOIA 2005 s.274A).
   *
   * 20% of the LOWEST of: finance costs, property profits, and adjusted total
   * income (total income less personal allowance, ignoring property income).
   * Taking the lowest is what stops a heavily geared year producing relief on
   * an amount the taxpayer never had.
   */
  const adjustedTotalIncome = otherIncome
    .subtract(Money.of(UK_CONSTANTS.personalAllowance, currency))
    .clampLow();

  const reducerBase = interest.clampLow().min(profit).min(adjustedTotalIncome);
  const reducerRate = Decimal.of(UK_CONSTANTS.financeCostReliefRate);
  const reducer = Money.of(
    reducerBase.amount.multiply(reducerRate).divide(100, 2, ROUND.HALF_UP),
    currency,
  );

  t.line({
    label: 'Finance-cost tax reducer',
    detail: `${reducerRate.toString()}% of the lower of finance costs (${interest.amount}), `
      + `property profit (${profit.amount}) and adjusted total income (${adjustedTotalIncome.amount})`,
    rate: reducerRate,
    base: reducerBase,
    amount: reducer.negate(),
  });

  const net = grossTax.subtract(reducer).clampLow();
  t.line({ label: 'Tax on property income', amount: net, note: 'after the reducer' })
    .limitation('Since April 2020 mortgage interest is not deductible for an individual landlord; only a basic-rate reducer is available. A company is taxed differently and is out of scope.')
    .limitation('The first £1,000 of property income may be covered by the property allowance; it is not applied automatically here.')
    .limitation('The personal allowance taper above £100,000 of adjusted net income is not modelled.')
    .result(net);

  if (facts.ownership !== OWNERSHIP.INDIVIDUAL) {
    t.status(STATUS.UNSUPPORTED)
      .warn('Company landlords pay Corporation Tax and DO get full relief for finance costs. This calculation is for an individual and does not apply.');
  }

  return {
    taxableProfit: profit,
    tax: net,
    reliefs: reducer,
    allowanceUsed: zero,
    suspendedLoss: zero,
    status: t.currentStatus(),
    trace: t.build(),
  };
}

/* ------------------------------------------------------------------ *
 * Japan
 * ------------------------------------------------------------------ */

function japan(ctx) {
  const { currency, netOperatingIncome, interest, depreciation, otherIncome, on } = ctx;
  const zero = Money.zero(currency);
  const t = trace('income.jp', '不動産所得 — Japanese tax on property income');

  const rule = registry.resolve({
    country: 'JP', category: CATEGORY.INCOME_TAX, on,
    facts: { ownership: OWNERSHIP.INDIVIDUAL },
  }).rule;
  if (!rule) return unsupportedResult(currency, `No Japanese income tax rule in force on ${on}.`);

  const taxable = netOperatingIncome.subtract(interest).subtract(depreciation);
  t.formula('national progressive tax on (income less interest less depreciation), plus 2.1% surtax on the tax, plus local inhabitant tax')
    .input('netOperatingIncome', netOperatingIncome)
    .line({ label: 'Less mortgage interest', amount: interest.negate() })
    .line({ label: 'Less depreciation (減価償却費)', amount: depreciation.negate() })
    .line({ label: '不動産所得 (property income)', amount: taxable });

  if (!taxable.isPositive()) {
    t.line({ label: 'No tax — the property made a loss', amount: zero })
      .limitation('A Japanese property loss can generally be set against other income (損益通算), except for the part attributable to interest on land. That offset is not modelled, so a loss year shows no benefit here.')
      .result(zero);
    return { taxableProfit: zero, tax: zero, reliefs: zero, allowanceUsed: zero, suspendedLoss: taxable.negate(), status: STATUS.VERIFIED, trace: t.build() };
  }

  const { amount: national, trace: nationalTrace } = marginalCharge(rule, otherIncome, taxable);
  t.child(nationalTrace).line({ label: '所得税 (national income tax)', amount: national });

  const { amount: surtax, trace: surtaxTrace } = evaluateRule(RECONSTRUCTION_SURTAX, national);
  t.child(surtaxTrace).line({ label: '復興特別所得税 (reconstruction surtax, 2.1% of the tax)', amount: surtax });

  // Local inhabitant tax is a flat 10% of taxable income.
  const inhabitantRate = Decimal.of(JP_CONSTANTS.localInhabitantTaxOnIncome);
  const inhabitant = Money.of(
    taxable.amount.multiply(inhabitantRate).divide(100, 0, ROUND.DOWN),
    currency,
  );
  t.line({
    label: '住民税 (local inhabitant tax)',
    detail: `${inhabitantRate.toString()}% of property income`,
    rate: inhabitantRate,
    base: taxable,
    amount: inhabitant,
  });

  const total = sumMoney([national, surtax, inhabitant], currency);
  t.line({ label: 'Total tax on property income', amount: total, note: 'national + surtax + inhabitant' })
    // The inhabitant tax rate is not yet confirmed against a primary source.
    .status(STATUS.ESTIMATED)
    .assume('Local inhabitant tax is taken at a flat 10%, the standard combined prefectural and municipal rate. It has not been confirmed against a primary source in this pass, and a municipality may vary it.')
    .limitation('The 青色申告特別控除 (blue return deduction) and other personal deductions are not applied.')
    .limitation('Loss offset against other income (損益通算) is not modelled, and the land-interest portion of a loss is restricted in any case.')
    .result(total);

  return { taxableProfit: taxable, tax: total, reliefs: zero, allowanceUsed: zero, suspendedLoss: zero, status: STATUS.ESTIMATED, trace: t.build() };
}

/* ------------------------------------------------------------------ *
 * United States
 * ------------------------------------------------------------------ *
 * Three schedules stack on rental income in New York City, and a loss does not
 * simply reduce tax — under section 469 it is passive, so it is suspended and
 * carried to the disposal except for the section 469(i) allowance.
 */
function unitedStates(ctx) {
  const { currency, netOperatingIncome, interest, depreciation, otherIncome, on, scenario, facts } = ctx;
  const zero = Money.zero(currency);
  const t = trace('income.us', 'US tax on rental income');

  const filingStatus = facts.filingStatus === 'mfj' ? 'mfj' : 'single';
  const lookup = (region, locality) => registry.resolve({
    country: 'US', region, locality, category: CATEGORY.INCOME_TAX, on,
    component: locality ? COMPONENT.SURTAX : (region ? COMPONENT.LOCAL : COMPONENT.NATIONAL),
    facts: { ownership: OWNERSHIP.INDIVIDUAL, filingStatus },
  }).rule;

  const federal = lookup(null, null);
  if (!federal) return unsupportedResult(currency, `No federal ordinary income tax rule in force on ${on}.`);

  const taxable = netOperatingIncome.subtract(interest).subtract(depreciation);
  t.formula('federal + state + city marginal tax on (income less interest less depreciation), with section 469 applied to a loss')
    .input('netOperatingIncome', netOperatingIncome)
    .line({ label: 'Less mortgage interest', amount: interest.negate() })
    .line({ label: 'Less depreciation', amount: depreciation.negate() })
    .line({ label: 'Net rental income', amount: taxable });

  // --- a loss is passive unless the taxpayer says otherwise (section 469) ---
  let deductibleNow = taxable;
  let suspended = zero;
  let allowanceUsed = zero;

  if (taxable.isNegative() && scenario?.hold?.passiveAllowed !== true) {
    const loss = taxable.negate();
    const allowance = section469Allowance(otherIncome, filingStatus, scenario, currency);
    const used = loss.min(allowance);
    allowanceUsed = used;
    suspended = loss.subtract(used);
    deductibleNow = used.negate();

    t.line({
      label: 'Section 469(i) special allowance',
      detail: 'up to 25,000 dollars of loss deductible now for an actively participating individual, '
        + 'reduced by 50 cents per dollar of income above 100,000 and nil at 150,000',
      amount: used,
    });
    t.line({ label: 'Loss suspended and carried to the disposal', amount: suspended });
  }

  // --- the three schedules -------------------------------------------------
  const parts = [];
  const { amount: fed, trace: fedTrace } = marginalCharge(federal, otherIncome, deductibleNow);
  parts.push(fed);
  t.child(fedTrace).line({ label: 'Federal income tax', amount: fed });

  const state = lookup('US-NY', null);
  if (state) {
    const { amount, trace: st } = marginalCharge(state, otherIncome, deductibleNow);
    parts.push(amount);
    t.child(st).line({ label: 'New York State income tax', amount });
    // The state schedules are secondary-sourced; the whole figure inherits that.
    t.atMost(state.verification);
  }

  // The city tax applies only to a city RESIDENT, which is a separate question
  // from where the property is.
  if (scenario?.profile?.nycResident !== false) {
    const city = lookup('US-NY', 'NYC');
    if (city) {
      const { amount, trace: ct } = marginalCharge(city, otherIncome, deductibleNow);
      parts.push(amount);
      t.child(ct).line({ label: 'New York City resident income tax', amount });
      t.atMost(city.verification);
    }
  } else {
    t.line({ label: 'New York City resident income tax', detail: 'not a city resident', amount: zero });
  }

  const total = sumMoney(parts, currency);
  t.line({ label: 'Total tax on rental income', amount: total, note: 'federal + state + city' })
    .limitation('Net Investment Income Tax under section 1411 is computed separately and is not included in this figure.')
    .limitation('Bands apply to taxable income after deductions; supply other income on that basis.')
    .result(total);

  if (scenario?.hold?.passiveAllowed === true) {
    t.assume('Rental losses are treated as deductible as they arise. That requires real estate professional status or offsetting passive income.');
  }

  return {
    taxableProfit: taxable,
    tax: total,
    reliefs: zero,
    allowanceUsed,
    suspendedLoss: suspended,
    status: t.currentStatus(),
    trace: t.build(),
  };
}

/**
 * Section 469(i) allowance, phased out between 100,000 and 150,000 of income.
 *
 * Married filing separately gets nil unless the spouses lived apart for the
 * whole year, which the model does not assume — the safer default.
 */
function section469Allowance(otherIncome, filingStatus, scenario, currency) {
  if (scenario?.profile?.activeParticipation === false) return Money.zero(currency);
  if (filingStatus === 'mfs') return Money.zero(currency);

  const max = Money.of(SECTION_469_ALLOWANCE.max, currency);
  const start = Money.of(SECTION_469_ALLOWANCE.phaseStart, currency);
  const over = otherIncome.subtract(start).clampLow();
  const reduction = Money.of(
    over.amount.multiply(Decimal.of(SECTION_469_ALLOWANCE.phaseRate)),
    currency,
  );
  return max.subtract(reduction).clampLow();
}
