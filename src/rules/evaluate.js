/**
 * evaluate.js — turn a rule plus a base amount into a charge, with a trace.
 *
 * This is the only place in the product that applies a rate to a number. Every
 * jurisdiction's transaction taxes, income taxes, surcharges and reliefs route
 * through here, which is what makes the SLICE/CLIFF distinction testable once
 * instead of re-implemented per country (and re-broken per country).
 *
 * Everything is exact: bases and rates are Decimals, band comparisons are
 * exact decimal comparisons, and rounding happens once, explicitly, where the
 * rule says it should.
 */

import { Decimal, ROUND } from '../core/decimal.js';
import { Money } from '../core/money.js';
import { trace, STATUS } from '../core/trace.js';
import { METHOD } from './schema.js';

const HUNDRED = Decimal.of(100);
/** Working precision for intermediate rate arithmetic, rounded once at the end. */
const WORK_SCALE = 12;

/**
 * Apply `rule` to `base`.
 *
 * @param {object} rule      a rule from defineRule()
 * @param {Money}  base      the amount the charge is computed on
 * @param {object} [opts]
 * @param {Decimal|number|string} [opts.quantity]  for PER_UNIT rules
 * @param {string} [opts.label]  overrides the trace label
 * @returns {{ amount: Money, trace: object }}
 */
export function evaluateRule(rule, base, opts = {}) {
  if (!(base instanceof Money)) throw new TypeError('evaluateRule: base must be Money');
  if (base.currency !== rule.currency) {
    throw new TypeError(
      `evaluateRule: rule ${rule.id} is denominated in ${rule.currency} but the base is ${base.currency}`,
    );
  }

  const t = trace(rule.id, opts.label || rule.name).fromRule(rule);
  t.input('base', base);

  // --- 1. statutory floor: below this, no charge arises at all ----------
  if (rule.exemptBelow && base.amount.lt(rule.exemptBelow)) {
    const zero = Money.zero(rule.currency);
    t.formula(`no charge below ${rule.exemptBelow.toString()}`)
      .line({ label: 'Below exemption threshold', base, amount: zero, detail: `threshold ${rule.exemptBelow.toString()}` })
      .result(zero);
    return { amount: zero, trace: t.build() };
  }

  // --- 2. round the taxable base down if the statute says so ------------
  let working = base;
  if (rule.rounding.baseFloorToUnit) {
    const unit = Decimal.of(rule.rounding.baseFloorToUnit);
    const floored = working.floorToUnit(unit);
    if (!floored.equals(working)) {
      t.line({
        label: 'Taxable base rounded down',
        detail: `to the nearest ${unit.toString()} ${rule.currency}`,
        base: working,
        amount: floored,
      });
    }
    working = floored;
  }

  // --- 3. compute -------------------------------------------------------
  let gross;
  switch (rule.method) {
    case METHOD.PROGRESSIVE_SLICE: gross = progressiveSlice(rule, working, t); break;
    case METHOD.CLIFF_WHOLE_VALUE: gross = cliffWholeValue(rule, working, t); break;
    case METHOD.FLAT_RATE: gross = flatRate(rule, working, t); break;
    case METHOD.FIXED_AMOUNT: gross = fixedAmount(rule, working, t); break;
    case METHOD.PER_UNIT: gross = perUnit(rule, working, t, opts.quantity); break;
    default: throw new Error(`evaluateRule: unhandled method ${rule.method}`);
  }

  // --- 4. statutory cap -------------------------------------------------
  if (rule.cap) {
    const cap = Money.of(rule.cap, rule.currency);
    if (gross.gt(cap)) {
      t.line({ label: 'Statutory cap applied', base: gross, amount: cap });
      gross = cap;
    }
  }

  // --- 5. round the result ---------------------------------------------
  let final = gross.quantize(rule.rounding.mode);
  if (rule.rounding.scale !== final.definition.exponent) {
    final = Money.of(gross.amount.rescale(rule.rounding.scale, rule.rounding.mode), rule.currency);
  }
  if (rule.rounding.floorToUnit) {
    const unit = Decimal.of(rule.rounding.floorToUnit);
    const floored = final.floorToUnit(unit);
    if (!floored.equals(final)) {
      t.line({
        label: 'Tax rounded down',
        detail: `to the nearest ${unit.toString()} ${rule.currency}`,
        base: final,
        amount: floored,
      });
    }
    final = floored;
  }

  t.result(final);
  return { amount: final, trace: t.build() };
}

/* ------------------------------------------------------------------ *
 * Methods
 * ------------------------------------------------------------------ */

/**
 * Each slice of the base is charged at its own band's rate.
 *
 * The trace records every band that contributed, including its width and the
 * slice actually charged, because "why is my SDLT £31,250" is answered by the
 * band breakdown and by nothing else.
 */
function progressiveSlice(rule, base, t) {
  t.formula('sum over bands of (slice within band x band rate)');
  let total = Decimal.of(0);
  const value = base.amount;

  for (let i = 0; i < rule.bands.length; i++) {
    const band = rule.bands[i];
    const upper = i + 1 < rule.bands.length ? rule.bands[i + 1].from : null;
    if (value.lte(band.from)) break;

    const top = upper === null ? value : value.min(upper);
    const slice = top.subtract(band.from);
    if (!slice.isPositive()) continue;

    const charge = slice.multiply(band.rate).divide(HUNDRED, WORK_SCALE, ROUND.HALF_EVEN);
    total = total.add(charge);

    t.line({
      label: band.label || bandLabel(rule, band, upper),
      detail: `${band.rate.toString()}% on ${slice.toString()}`,
      rate: band.rate,
      base: Money.of(slice, rule.currency),
      amount: Money.of(charge, rule.currency),
    });
  }
  return Money.of(total, rule.currency);
}

/**
 * The entire base is charged at the rate of the highest band it reaches.
 *
 * The trace explicitly names the next threshold up and what crossing it would
 * cost, because with a cliff charge that is the number that changes a bid.
 */
function cliffWholeValue(rule, base, t) {
  t.formula('entire value x rate of the highest band reached (cliff)');
  const value = base.amount;

  let selected = null;
  let selectedIndex = -1;
  for (let i = 0; i < rule.bands.length; i++) {
    if (value.gte(rule.bands[i].from)) { selected = rule.bands[i]; selectedIndex = i; } else break;
  }
  if (!selected) return Money.zero(rule.currency);

  const charge = value.multiply(selected.rate).divide(HUNDRED, WORK_SCALE, ROUND.HALF_EVEN);

  t.line({
    label: selected.label || `Band from ${selected.from.toString()}`,
    detail: `${selected.rate.toString()}% on the whole value (cliff, not marginal)`,
    rate: selected.rate,
    base,
    amount: Money.of(charge, rule.currency),
  });

  const next = rule.bands[selectedIndex + 1];
  if (next) {
    const atNext = next.from.multiply(next.rate).divide(HUNDRED, WORK_SCALE, ROUND.HALF_EVEN);
    const step = atNext.subtract(charge);
    if (step.isPositive()) {
      t.warn(
        `Cliff threshold ahead: at ${next.from.toString()} the rate becomes ${next.rate.toString()}% ` +
        `on the entire value, an immediate increase of about ${step.rescale(0, ROUND.HALF_UP).toString()} ${rule.currency}.`,
      );
    }
  }
  return Money.of(charge, rule.currency);
}

function flatRate(rule, base, t) {
  const band = rule.bands[0];
  t.formula(`base x ${band.rate.toString()}%`);
  const charge = base.amount.multiply(band.rate).divide(HUNDRED, WORK_SCALE, ROUND.HALF_EVEN);
  t.line({
    label: band.label || rule.name,
    detail: `${band.rate.toString()}% of ${base.amount.toString()}`,
    rate: band.rate,
    base,
    amount: Money.of(charge, rule.currency),
  });
  return Money.of(charge, rule.currency);
}

function fixedAmount(rule, base, t) {
  t.formula('fixed amount selected by the band the base falls in');
  const value = base.amount;
  let selected = null;
  for (const band of rule.bands) {
    if (value.gte(band.from)) selected = band; else break;
  }
  if (!selected) return Money.zero(rule.currency);
  t.line({
    label: selected.label || `Band from ${selected.from.toString()}`,
    detail: `fixed charge for values from ${selected.from.toString()}`,
    base,
    amount: Money.of(selected.amount, rule.currency),
  });
  return Money.of(selected.amount, rule.currency);
}

function perUnit(rule, base, t, quantity) {
  if (quantity == null) throw new TypeError(`evaluateRule: rule ${rule.id} is PER_UNIT and requires opts.quantity`);
  const q = Decimal.of(quantity);
  const band = rule.bands[0];
  t.formula(`${band.rate.toString()} per unit x quantity`);
  const charge = band.rate.multiply(q);
  t.line({
    label: band.label || rule.name,
    detail: `${q.toString()} units at ${band.rate.toString()} each`,
    base: Money.of(charge, rule.currency),
    amount: Money.of(charge, rule.currency),
  });
  return Money.of(charge, rule.currency);
}

function bandLabel(rule, band, upper) {
  const from = band.from.toString();
  return upper === null ? `Above ${from}` : `${from} to ${upper.toString()}`;
}

/**
 * Marginal charge: what `amount` costs when stacked on top of `base` income.
 *
 * This is the figure a property decision actually turns on — not the average
 * rate across all income and not the top statutory rate, but what this deal
 * adds to the bill. A negative `amount` (a deductible loss) correctly yields a
 * negative charge, i.e. a saving.
 */
export function marginalCharge(rule, baseIncome, amount, opts = {}) {
  const zero = Money.zero(rule.currency);
  const withoutBase = baseIncome.lt(zero) ? zero : baseIncome;
  const stacked = withoutBase.add(amount);
  const stackedFloored = stacked.lt(zero) ? zero : stacked;

  const before = evaluateRule(rule, withoutBase, opts);
  const after = evaluateRule(rule, stackedFloored, opts);
  const delta = after.amount.subtract(before.amount);

  const t = trace(`${rule.id}.marginal`, `${rule.name} — marginal effect`)
    .fromRule(rule)
    .formula('tax(base + amount) - tax(base)')
    .input('otherIncome', withoutBase)
    .input('amount', amount)
    .line({ label: 'Tax on other income alone', base: withoutBase, amount: before.amount })
    .line({ label: 'Tax with this property included', base: stackedFloored, amount: after.amount })
    .line({ label: 'Attributable to this property', amount: delta })
    .child(before.trace)
    .child(after.trace)
    .result(delta);

  return { amount: delta, trace: t.build() };
}

/** A charge that could not be computed because no rule covers the case. */
export function unsupported(id, label, reason, currency) {
  const t = trace(id, label)
    .status(STATUS.UNSUPPORTED)
    .formula('not computed')
    .warn(reason)
    .result(Money.zero(currency));
  return { amount: Money.zero(currency), trace: t.build(), unsupported: true };
}
