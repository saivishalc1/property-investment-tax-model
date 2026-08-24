/**
 * transactions.js — acquisition and disposal taxes, computed from the registry.
 *
 * This is the first part of the model to move off the hardcoded tables. It is
 * deliberately the first, because transaction taxes are where the old engine's
 * errors cost the most money per keystroke: cliff thresholds that re-rate an
 * entire purchase, surcharges that depend on residency, and unit charges that
 * are not percentages at all.
 *
 * Everything here is exact (Money on BigInt), carries a trace, and refuses to
 * produce a figure it cannot source. A jurisdiction with no rule pack gets an
 * explicit unsupported result, never a number borrowed from somewhere else.
 */

import { Money, sumMoney } from '../core/money.js';
import { STATUS, weakestStatus, trace } from '../core/trace.js';
import { registry } from '../rules/index.js';
import { evaluateRule } from '../rules/evaluate.js';
import { CATEGORY, PROPERTY_CLASS, RESIDENCY, OWNERSHIP, BASIS } from '../rules/schema.js';
import { jurisdictionFor, COVERAGE } from './jurisdiction.js';

/**
 * Transaction-tax categories, by side of the deal.
 *
 * These are intersected with the categories the jurisdiction actually LEVIES.
 * The distinction matters: the United Kingdom has no registration tax on a
 * land purchase, so finding no registration-tax rule there is not a gap in the
 * model — it is the law. Japan does levy one, so finding none there WOULD be a
 * gap. Treating every absent category as a gap, which an earlier version of
 * this file did, marks every result unsupported and teaches the user to ignore
 * the warning that matters.
 */
const ACQUISITION_CATEGORIES = [
  CATEGORY.ACQUISITION_TAX,
  CATEGORY.TRANSFER_TAX,
  CATEGORY.REGISTRATION_TAX,
  CATEGORY.STAMP_TAX,
];

/** Categories that arise on disposal. */
const DISPOSAL_CATEGORIES = [CATEGORY.TRANSFER_TAX];

/**
 * Map the scenario's own vocabulary onto the rule packs' fact vocabulary.
 *
 * The application calls a co-op a property type; the rule packs care whether
 * something is residential. Keeping the translation in one function means a
 * new jurisdiction does not have to learn the application's history.
 */
export function factsFromScenario(scenario) {
  const propType = scenario?.purchase?.propType;
  const propertyClass = propType === 'commercial'
    ? PROPERTY_CLASS.COMMERCIAL
    : PROPERTY_CLASS.RESIDENTIAL; // co-op and condo are residential for tax

  const profile = scenario?.profile || {};
  return {
    propertyClass,
    ownership: profile.ownerType === 'company' ? OWNERSHIP.COMPANY : OWNERSHIP.INDIVIDUAL,
    residency: profile.taxResident === false ? RESIDENCY.NON_RESIDENT : RESIDENCY.RESIDENT,
    // This product models investment property, so the buyer is assumed to own
    // another residential property unless they say otherwise. In the United
    // Kingdom that is worth five points on every SDLT band.
    additionalProperty: profile.soleProperty === true ? 'sole' : 'additional',
    filingStatus: profile.filingStatus || 'single',
  };
}

/**
 * Compute every transaction charge arising on one side of a deal.
 *
 * @param {object} scenario  the application's scenario state
 * @param {object} opts
 * @param {'acquisition'|'disposal'} opts.side
 * @param {Money}  opts.consideration  the purchase or sale price
 * @param {Money}  [opts.assessedValue] value on the tax roll, where a rule needs it
 * @param {Money}  [opts.leaseNpv]      net present value of rent on a new lease
 * @param {Money}  [opts.loanAmount]    sum borrowed, for mortgage recording taxes
 * @param {string} opts.on ISO date of the transaction
 * @returns {{ charges: Array, total: Money|null, status: string,
 *             unsupported: Array, traces: Array, currency: string|null }}
 */
export function computeTransactionTaxes(scenario, {
  side, consideration, on, assessedValue = null, leaseNpv = null, loanAmount = null,
}) {
  const presetKey = scenario?.meta?.preset;
  const jurisdiction = jurisdictionFor(presetKey);

  if (jurisdiction.coverage !== COVERAGE.MODELLED) {
    return {
      charges: [],
      total: null,
      status: STATUS.UNSUPPORTED,
      currency: null,
      traces: [],
      totalStatus: STATUS.UNSUPPORTED,
      complete: false,
      unsupported: [{
        jurisdiction: presetKey,
        reason: jurisdiction.reason,
        authority: null,
        url: null,
      }],
      incomplete: [],
    };
  }

  if (!(consideration instanceof Money)) {
    throw new TypeError('computeTransactionTaxes: consideration must be Money');
  }
  if (consideration.currency !== jurisdiction.currency) {
    throw new TypeError(
      `computeTransactionTaxes: ${presetKey} is denominated in ${jurisdiction.currency} `
      + `but the consideration is ${consideration.currency}`,
    );
  }

  const facts = factsFromScenario(scenario);
  const forSide = side === 'acquisition' ? ACQUISITION_CATEGORIES : DISPOSAL_CATEGORIES;
  // Only categories this jurisdiction actually charges.
  const categories = forSide.filter((c) => jurisdiction.levies.includes(c));

  /**
   * The amounts available to charge against.
   *
   * A rule declares which of these it is computed on. Anything not supplied is
   * null, and a rule needing it is skipped with a reason rather than being fed
   * the price — which is how a lease-rent charge came to be levied on a
   * freehold purchase, and how Japanese taxes charged on assessed value came to
   * be charged on market price.
   */
  const bases = {
    [BASIS.CONSIDERATION]: consideration,
    [BASIS.ASSESSED_VALUE]: assessedValue,
    [BASIS.LEASE_NPV]: leaseNpv,
    [BASIS.LOAN_AMOUNT]: loanAmount,
  };

  const charges = [];
  const traces = [];
  const unsupported = [];
  const statuses = [];
  const missingBasis = [];

  for (const category of categories) {
    const { rules, unsupported: gap } = registry.resolveAll({
      country: jurisdiction.country,
      region: jurisdiction.region,
      locality: jurisdiction.locality,
      category,
      on,
      facts,
    });

    if (gap) {
      // The jurisdiction levies this category and we have no rule for it. That
      // is a real gap: reported, never filled from a neighbouring rule.
      unsupported.push({ category, ...gap });
      statuses.push(STATUS.UNSUPPORTED);
      continue;
    }

    for (const rule of rules) {
      // Only charges borne by this side of the transaction belong here. A
      // seller-paid transfer tax is not part of a buyer's cash at closing.
      if (!appliesToSide(rule, side)) continue;

      const base = bases[rule.basis];
      if (base == null) {
        // The rule is real and in force; we simply have not been given the
        // amount it is charged on. Skipping and saying so is the only honest
        // option — substituting the price produces a confident wrong number.
        missingBasis.push({ rule, basis: rule.basis });
        continue;
      }

      const { amount, trace: t } = evaluateRule(rule, base);
      charges.push({
        id: rule.id,
        label: rule.name,
        category: rule.category,
        component: rule.component,
        payer: rule.payer,
        amount,
        status: rule.verification,
        citations: rule.citations,
        limitations: rule.limitations,
      });
      traces.push(t);
      statuses.push(t.effectiveStatus());
    }
  }

  // Costs the jurisdiction pack knows it does not model. These do not make the
  // computed figures wrong, but they do make the TOTAL incomplete, so they are
  // carried through as warnings rather than silently dropped.
  const incomplete = jurisdiction.knownGaps
    .filter((g) => g.side === 'both' || g.side === side)
    .map((g) => ({ category: null, reason: g.reason, authority: jurisdiction.authority, url: null }));

  for (const m of missingBasis) {
    incomplete.push({
      category: m.rule.category,
      reason: `${m.rule.name} is not included: it is charged on ${describeBasis(m.basis)}, `
        + 'which this scenario does not supply. Enter that figure to include the charge.',
      authority: jurisdiction.authority,
      url: m.rule.citations[0]?.url || null,
    });
  }

  const total = charges.length
    ? sumMoney(charges.map((c) => c.amount), jurisdiction.currency)
    : Money.zero(jurisdiction.currency);

  /**
   * Is the TOTAL the whole bill?
   *
   * Each charge can be individually verified while the total still understates
   * what will actually be paid, because a charge was skipped for want of its
   * basis or is a documented omission. A zero total presented as "verified" is
   * the worst possible output: it is not a calculation, it is an absence, and
   * it looks identical to a genuine nil charge.
   */
  const complete = incomplete.length === 0 && unsupported.length === 0;

  return {
    charges,
    total,
    currency: jurisdiction.currency,
    /** Confidence in the charges that WERE computed. */
    status: statuses.length ? weakestStatus(statuses) : STATUS.VERIFIED,
    /** Confidence in the TOTAL, which is weaker whenever something is missing. */
    totalStatus: complete
      ? (statuses.length ? weakestStatus(statuses) : STATUS.VERIFIED)
      : STATUS.ESTIMATED,
    complete,
    traces,
    unsupported,
    incomplete,
  };
}

/**
 * Does this charge fall on the side of the deal being computed?
 *
 * A rule with no payer is a charge on the transaction rather than on a party,
 * so it counts on the acquisition side where cash actually moves.
 */
/** Plain-English name for a charging basis, for the user-facing message. */
function describeBasis(basis) {
  switch (basis) {
    case BASIS.ASSESSED_VALUE: return 'the assessed value on the tax roll, not the purchase price';
    case BASIS.LEASE_NPV: return 'the net present value of rent over a new lease';
    case BASIS.LOAN_AMOUNT: return 'the amount borrowed, not the purchase price';
    default: return 'an amount';
  }
}

function appliesToSide(rule, side) {
  if (side === 'acquisition') return rule.payer !== 'seller';
  return rule.payer === 'seller';
}

/**
 * A combined trace for a whole side of a transaction, suitable for a report.
 */
export function transactionTrace(result, label) {
  const t = trace(`transaction.${label}`, label)
    .formula('sum of every charge arising on this side of the transaction');

  if (result.total) t.input('total', result.total);

  for (const c of result.charges) {
    t.line({ label: c.label, detail: `payable by the ${c.payer}`, amount: c.amount });
  }
  for (const u of result.unsupported) t.warn(u.reason);
  for (const i of result.incomplete || []) t.limitation(i.reason);
  for (const child of result.traces) t.child(child);

  if (!result.complete) {
    t.warn('This total is incomplete: at least one charge could not be computed or is not modelled. '
      + 'It understates what will actually be payable.');
  }
  return t.status(result.totalStatus).result(result.total || Money.zero('USD')).build();
}

/**
 * Split a transaction result by who pays, which is what a sources-and-uses
 * statement needs and what the old model conflated.
 */
export function byPayer(result) {
  const out = { buyer: [], seller: [], owner: [] };
  for (const c of result.charges) {
    const key = c.payer || 'buyer';
    if (out[key]) out[key].push(c);
  }
  return out;
}
