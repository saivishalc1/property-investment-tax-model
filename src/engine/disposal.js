/**
 * disposal.js — tax on the sale, per jurisdiction.
 *
 * Three regimes that share almost nothing:
 *
 *   United States  The gain is split. Whatever depreciation was claimed comes
 *                  back first as unrecaptured section 1250 gain, taxed at
 *                  ordinary rates but CAPPED at 25%; only the residual is
 *                  long-term capital gain, stacked above ordinary income AND
 *                  above the recapture. NIIT applies on top, and New York taxes
 *                  the whole gain as ordinary income because it has no
 *                  preferential rate. Suspended passive losses are released.
 *
 *   United Kingdom Gain less the annual exempt amount, then 18% while the total
 *                  sits inside the basic rate band and 24% above it. No
 *                  depreciation was claimed, so there is nothing to recapture.
 *
 *   Japan          Everything turns on the five-year line measured at 1 JANUARY
 *                  OF THE YEAR OF SALE. Long term is 15% national + 5% local;
 *                  short term is 30% + 9%; the reconstruction surtax is 2.1% of
 *                  the national component. There is no recapture concept — the
 *                  depreciation is already reflected in the reduced book cost.
 */

import { Decimal, ROUND } from '../core/decimal.js';
import { Money, sumMoney } from '../core/money.js';
import { trace, STATUS } from '../core/trace.js';
import { registry } from '../rules/index.js';
import { evaluateRule, marginalCharge } from '../rules/evaluate.js';
import { CATEGORY, COMPONENT, OWNERSHIP, HOLDING_PERIOD } from '../rules/schema.js';
import { jurisdictionFor, COVERAGE } from './jurisdiction.js';
import { factsFromScenario } from './transactions.js';
import { UK_CONSTANTS } from '../rules/jurisdictions/uk.js';
import {
  RECONSTRUCTION_SURTAX, jpHoldingPeriodIsLongTerm,
} from '../rules/jurisdictions/jp.js';
import { FEDERAL_1250_CAP, NIIT, NIIT_THRESHOLDS } from '../rules/jurisdictions/us-ny.js';

/**
 * Tax arising on a disposal.
 *
 * @param {object} scenario
 * @param {object} sale
 * @param {Money}  sale.gain                total taxable gain (nil if a loss)
 * @param {Money}  sale.accumulatedDepreciation  claimed over the hold
 * @param {Money}  sale.otherIncome         the investor's other taxable income
 * @param {Money}  sale.suspendedLosses     carried passive losses, if any
 * @param {string} sale.acquisitionDate     ISO
 * @param {string} sale.disposalDate        ISO
 * @param {string} [sale.rulesAsAt]         ISO date whose LAW to apply
 */
export function computeDisposalTax(scenario, sale) {
  const j = jurisdictionFor(scenario?.meta?.preset);
  const currency = sale.gain.currency;

  if (j.coverage !== COVERAGE.MODELLED) {
    const zero = Money.zero(currency);
    return {
      total: zero, components: [], status: STATUS.UNSUPPORTED,
      trace: trace('disposal', 'Tax on sale')
        .status(STATUS.UNSUPPORTED).formula('not computed').warn(j.reason).result(zero).build(),
    };
  }

  const facts = factsFromScenario(scenario);

  /*
   * WHICH LAW, versus WHICH DATES.
   *
   * A projected sale seven years out falls beyond the effective window of
   * every rule in the packs, because nobody has legislated 2033 yet. Resolving
   * rules on the projected date therefore finds nothing and the model goes
   * silent — which is not honest either, since the useful answer is "under
   * today's law, this is what it would cost".
   *
   * So rules resolve as at `rulesAsAt` (today unless told otherwise) and the
   * trace records that assumption, while the DATES still drive anything that
   * depends on elapsed time — above all Japan's five-year test, which is
   * measured from the real acquisition to 1 January of the real year of sale.
   */
  const rulesAsAt = sale.rulesAsAt || new Date().toISOString().slice(0, 10);
  const ctx = { scenario, j, facts, currency, ...sale, on: rulesAsAt, rulesAsAt };

  if (j.country === 'GB') return unitedKingdom(ctx);
  if (j.country === 'JP') return japan(ctx);
  if (j.country === 'US') return unitedStates(ctx);

  const zero = Money.zero(currency);
  return {
    total: zero, components: [], status: STATUS.UNSUPPORTED,
    trace: trace('disposal', 'Tax on sale').status(STATUS.UNSUPPORTED)
      .formula('not computed').warn(`No disposal rule for ${j.country}.`).result(zero).build(),
  };
}

/* ------------------------------------------------------------------ *
 * United Kingdom
 * ------------------------------------------------------------------ */

function unitedKingdom(ctx) {
  const { currency, gain, otherIncome, on } = ctx;
  const zero = Money.zero(currency);
  const t = trace('disposal.gb', 'UK Capital Gains Tax on the sale');

  const rule = registry.resolve({
    country: 'GB', category: CATEGORY.CAPITAL_GAINS_TAX, on,
    facts: { ownership: OWNERSHIP.INDIVIDUAL },
  }).rule;
  if (!rule) return unsupported(currency, `No UK capital gains rule in force on ${on}.`);

  t.formula('(gain less the annual exempt amount) taxed at 18% inside the basic rate band and 24% above it')
    .input('gain', gain);

  if (!gain.isPositive()) {
    t.line({ label: 'No chargeable gain', amount: zero })
      .limitation('An allowable loss can be set against other chargeable gains in the same year or carried forward. That relief is not modelled.')
      .result(zero);
    return { total: zero, components: [], status: STATUS.VERIFIED, trace: t.build() };
  }

  const aea = Money.of(UK_CONSTANTS.cgtAnnualExemptAmount, currency);
  const chargeable = gain.subtract(aea).clampLow();
  t.line({ label: 'Less the annual exempt amount', detail: `${UK_CONSTANTS.cgtAnnualExemptAmount} for the year`, amount: aea.negate() })
    .line({ label: 'Chargeable gain', amount: chargeable });

  const { amount, trace: child } = marginalCharge(rule, otherIncome, chargeable);
  noteProjection(t, ctx);
  t.child(child).line({ label: 'Capital Gains Tax', amount })
    .limitation('A UK residential property disposal must be reported and the tax paid within 60 days of completion. The model reports the liability but does not produce the return.')
    .limitation('The annual exempt amount is assumed unused elsewhere in the tax year.')
    .result(amount);

  return {
    total: amount,
    components: [{ key: 'capitalGains', label: 'Capital Gains Tax', amount, ruleId: rule.id, status: rule.verification }],
    status: rule.verification,
    trace: t.build(),
  };
}

/* ------------------------------------------------------------------ *
 * Japan
 * ------------------------------------------------------------------ */

function japan(ctx) {
  const { currency, gain, acquisitionDate, disposalDate } = ctx;
  const zero = Money.zero(currency);
  const t = trace('disposal.jp', '譲渡所得 — Japanese tax on the sale');

  if (!gain.isPositive()) {
    t.formula('no tax on a loss').line({ label: 'No chargeable gain', amount: zero })
      .limitation('A loss on a disposal of investment real property generally cannot be offset against other income in Japan.')
      .result(zero);
    return { total: zero, components: [], status: STATUS.VERIFIED, trace: t.build() };
  }

  // The whole regime turns on this test, and it is not measured from purchase.
  const held = jpHoldingPeriodIsLongTerm(acquisitionDate, disposalDate);
  const holdingPeriod = held.longTerm ? HOLDING_PERIOD.LONG : HOLDING_PERIOD.SHORT;

  t.formula('national + local tax at the rate set by the five-year test, plus a 2.1% surtax on the national tax')
    .input('gain', gain)
    .line({
      label: held.longTerm ? '長期譲渡所得 (long term)' : '短期譲渡所得 (short term)',
      detail: held.explanation,
    });

  const { rules } = registry.resolveAll({
    country: 'JP', category: CATEGORY.CAPITAL_GAINS_TAX, on: disposalDate,
    facts: { ownership: OWNERSHIP.INDIVIDUAL, holdingPeriod },
  });
  if (!rules.length) return unsupported(currency, `No Japanese capital gains rule in force on ${disposalDate}.`);

  const components = [];
  let national = zero;

  for (const rule of rules) {
    const { amount, trace: child } = evaluateRule(rule, gain);
    t.child(child).line({ label: rule.name, amount });
    components.push({
      key: rule.component === COMPONENT.NATIONAL ? 'capitalGains' : 'state',
      label: rule.name, amount, ruleId: rule.id, status: rule.verification,
    });
    if (rule.component === COMPONENT.NATIONAL) national = amount;
  }

  // The surtax is 2.1% OF THE NATIONAL TAX, not of the gain.
  const { amount: surtax, trace: surtaxTrace } = evaluateRule(RECONSTRUCTION_SURTAX, national);
  t.child(surtaxTrace).line({ label: '復興特別所得税 (2.1% of the national tax)', amount: surtax });
  components.push({ key: 'surtax', label: '復興特別所得税', amount: surtax, ruleId: RECONSTRUCTION_SURTAX.id, status: RECONSTRUCTION_SURTAX.verification });

  const total = sumMoney(components.map((c) => c.amount), currency);
  noteProjection(t, ctx);
  t.line({ label: 'Total tax on the sale', amount: total })
    .limitation('The 3,000万円 special deduction for a former residence (措法35) is not modelled.')
    .limitation('A non-resident seller is subject to 10.21% withholding on the gross price; that withholding is not modelled.')
    .result(total);

  if (!held.longTerm) {
    t.warn(
      `Selling after 1 January ${Number(disposalDate.slice(0, 4)) + (held.yearsAtReference >= 5 ? 1 : 5 - held.yearsAtReference)} `
      + 'would move this disposal to the long-term rate of 20.315% from 39.63%.',
    );
  }

  return { total, components, status: STATUS.VERIFIED, trace: t.build() };
}

/* ------------------------------------------------------------------ *
 * United States
 * ------------------------------------------------------------------ */

function unitedStates(ctx) {
  const { currency, gain, accumulatedDepreciation, otherIncome, on, facts, scenario } = ctx;
  const zero = Money.zero(currency);
  const t = trace('disposal.us', 'US tax on the sale');

  if (!gain.isPositive()) {
    t.formula('no tax on a loss')
      .line({ label: 'No taxable gain', amount: zero })
      .limitation('A loss on business or investment real property is an ordinary section 1231 loss. Its benefit is not computed here.')
      .result(zero);
    return { total: zero, components: [], status: STATUS.VERIFIED, trace: t.build() };
  }

  const filingStatus = facts.filingStatus === 'mfj' ? 'mfj' : 'single';
  const lookup = (category, region, locality, component) => registry.resolve({
    country: 'US', region, locality, category, on, component,
    facts: { ownership: OWNERSHIP.INDIVIDUAL, filingStatus },
  }).rule;

  const ordinaryRule = lookup(CATEGORY.INCOME_TAX, null, null, COMPONENT.NATIONAL);
  const ltcgRule = lookup(CATEGORY.CAPITAL_GAINS_TAX, null, null, COMPONENT.PRINCIPAL);
  if (!ordinaryRule || !ltcgRule) {
    return unsupported(currency, `No federal ordinary or capital gains rule in force on ${on}.`);
  }

  /*
   * Depreciation comes back FIRST. Unrecaptured section 1250 gain is capped at
   * the depreciation actually claimed and is taken out of the gain before the
   * residual is treated as long-term capital gain.
   */
  const unrecaptured = accumulatedDepreciation.min(gain).clampLow();
  const capitalGain = gain.subtract(unrecaptured).clampLow();

  t.formula('depreciation recaptured at ordinary rates capped at 25%, the residual as long-term gain stacked above it, plus NIIT and New York tax on the whole gain')
    .input('gain', gain)
    .input('accumulatedDepreciation', accumulatedDepreciation)
    .line({ label: 'Unrecaptured section 1250 gain', detail: 'capped at depreciation claimed', amount: unrecaptured })
    .line({ label: 'Long-term capital gain', detail: 'the residual', amount: capitalGain });

  const components = [];

  // --- recapture: ordinary rate, but never more than 25% -------------------
  if (unrecaptured.isPositive()) {
    const { amount: atOrdinary, trace: ordTrace } = marginalCharge(ordinaryRule, otherIncome, unrecaptured);
    const { amount: ceiling } = evaluateRule(FEDERAL_1250_CAP, unrecaptured);
    const charged = atOrdinary.min(ceiling);

    t.child(ordTrace).line({
      label: 'Tax on the recapture',
      detail: `ordinary rate would give ${atOrdinary.amount}; the 25% ceiling is ${ceiling.amount}; the lower applies`,
      amount: charged,
    });
    components.push({ key: 'recapture', label: 'Unrecaptured section 1250 gain', amount: charged, ruleId: FEDERAL_1250_CAP.id, status: STATUS.VERIFIED });
  }

  // --- long-term gain, stacked above ordinary income AND the recapture -----
  if (capitalGain.isPositive()) {
    const stackedOn = otherIncome.add(unrecaptured);
    const { amount, trace: child } = marginalCharge(ltcgRule, stackedOn, capitalGain);
    t.child(child).line({
      label: 'Federal long-term capital gains tax',
      detail: 'stacked above ordinary income and above the recapture',
      amount,
    });
    components.push({ key: 'capitalGains', label: 'Federal capital gains tax', amount, ruleId: ltcgRule.id, status: ltcgRule.verification });
  }

  // --- NIIT: 3.8% of the LESSER of net investment income and the excess ----
  const threshold = Money.of(NIIT_THRESHOLDS[filingStatus] || NIIT_THRESHOLDS.single, currency);
  const magi = otherIncome.add(gain);
  const excess = magi.subtract(threshold).clampLow();
  const niitBase = gain.min(excess);
  if (niitBase.isPositive()) {
    const { amount, trace: child } = evaluateRule(NIIT, niitBase);
    t.child(child).line({
      label: 'Net Investment Income Tax',
      detail: `3.8% of the lesser of the gain (${gain.amount}) and MAGI above ${threshold.amount} (${excess.amount})`,
      amount,
    });
    components.push({ key: 'niit', label: 'Net Investment Income Tax', amount, ruleId: NIIT.id, status: NIIT.verification });
  }

  // --- New York taxes the whole gain as ordinary income --------------------
  const stateRule = lookup(CATEGORY.INCOME_TAX, 'US-NY', null, COMPONENT.LOCAL);
  if (stateRule) {
    const { amount, trace: child } = marginalCharge(stateRule, otherIncome, gain);
    t.child(child).line({ label: 'New York State tax on the gain', detail: 'New York has no preferential capital gains rate', amount });
    components.push({ key: 'state', label: 'New York State tax on the gain', amount, ruleId: stateRule.id, status: stateRule.verification });
    t.atMost(stateRule.verification);
  }

  if (scenario?.profile?.nycResident !== false) {
    const cityRule = lookup(CATEGORY.INCOME_TAX, 'US-NY', 'NYC', COMPONENT.SURTAX);
    if (cityRule) {
      const { amount, trace: child } = marginalCharge(cityRule, otherIncome, gain);
      t.child(child).line({ label: 'New York City tax on the gain', amount });
      components.push({ key: 'city', label: 'New York City tax on the gain', amount, ruleId: cityRule.id, status: cityRule.verification });
      t.atMost(cityRule.verification);
    }
  }

  const total = sumMoney(components.map((c) => c.amount), currency);
  noteProjection(t, ctx);
  t.line({ label: 'Total tax on the sale', amount: total })
    .limitation('A section 1031 like-kind exchange defers this tax entirely. The comparison is shown separately.')
    .limitation('Suspended passive losses released on a fully taxable disposition under section 469(g) are handled by the caller, not here.')
    .limitation('New York nonresident estimated tax (IT-2663) and FIRPTA withholding are not modelled.')
    .result(total);

  return { total, components, status: t.currentStatus(), trace: t.build() };
}

/**
 * Record that a future disposal was priced under today's law.
 *
 * Not a warning — it is the only defensible basis for a projection — but it is
 * an assumption, and an assumption the reader is entitled to see.
 */
function noteProjection(t, ctx) {
  const saleYear = String(ctx.disposalDate || '').slice(0, 4);
  const lawYear = String(ctx.rulesAsAt || '').slice(0, 4);
  if (saleYear && lawYear && saleYear > lawYear) {
    t.assume(
      `The sale is projected for ${saleYear} and is priced under the law in force in ${lawYear}. `
      + 'Rates, bands and reliefs will change before then; this is the current-law answer, not a forecast of future law.',
    );
  }
}

function unsupported(currency, reason) {
  const zero = Money.zero(currency);
  return {
    total: zero, components: [], status: STATUS.UNSUPPORTED,
    trace: trace('disposal', 'Tax on sale')
      .status(STATUS.UNSUPPORTED).formula('not computed').warn(reason).result(zero).build(),
  };
}
