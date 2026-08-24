/**
 * trace.js — structured calculation traces.
 *
 * WHY. "The tax is £31,250" is not a usable answer for a professional. The
 * answer they can act on is: which rule, in force on which date, applied which
 * band to which slice of value, citing what, with which assumptions still
 * unverified. A number without that is a number nobody can defend to a client
 * or check against a statute.
 *
 * Every taxable figure the engine produces carries a Trace. The interface
 * renders it, the report prints it, and the tests assert on it — so an
 * explanation that drifts from the arithmetic is a test failure rather than a
 * discovery made by a customer.
 *
 * Traces are plain data. They serialise, diff, and survive a round trip
 * through JSON, which is what makes a saved scenario auditable later.
 */

import { Money } from './money.js';
import { Decimal } from './decimal.js';

/**
 * Confidence in a computed figure. This is the product's central honesty
 * mechanism: every result shows exactly one of these, and the overall status
 * of a scenario is the WEAKEST status of any figure inside it.
 */
export const STATUS = Object.freeze({
  /** Computed from a rule checked against a primary official source. */
  VERIFIED: 'verified',
  /** Computed from a figure the user supplied. Correct if their input is. */
  ASSUMPTION: 'assumption',
  /** Computed from a rule we could not confirm against a primary source, or
   *  from a default standing in for a required local rate. */
  ESTIMATED: 'estimated',
  /** No rule exists for this combination. There is no number, by design. */
  UNSUPPORTED: 'unsupported',
});

/** Weakest-wins ordering. Higher index is weaker. */
const STATUS_ORDER = [STATUS.VERIFIED, STATUS.ASSUMPTION, STATUS.ESTIMATED, STATUS.UNSUPPORTED];

/** Combine statuses: the result is only as strong as its weakest input. */
export function weakestStatus(statuses) {
  let worst = 0;
  for (const s of statuses) {
    const i = STATUS_ORDER.indexOf(s);
    if (i === -1) throw new RangeError(`weakestStatus: unknown status ${JSON.stringify(s)}`);
    if (i > worst) worst = i;
  }
  return STATUS_ORDER[worst];
}


/**
 * A single line of arithmetic within a trace — one band, one deduction, one
 * intermediate. Values are Money or Decimal so the renderer can format them
 * in the right currency rather than receiving pre-formatted strings.
 */
export class TraceLine {
  constructor({ label, detail = null, rate = null, base = null, amount = null, note = null }) {
    this.label = label;
    this.detail = detail;
    this.rate = rate;
    this.base = base;
    this.amount = amount;
    this.note = note;
    Object.freeze(this);
  }

  toJSON() {
    return {
      label: this.label,
      detail: this.detail,
      rate: this.rate ? this.rate.toString() : null,
      base: serialiseValue(this.base),
      amount: serialiseValue(this.amount),
      note: this.note,
    };
  }
}

function serialiseValue(v) {
  if (v == null) return null;
  if (v instanceof Money) return v.toJSON();
  if (v instanceof Decimal) return v.toString();
  return v;
}

/**
 * The trace for one computed figure.
 *
 * `result` is the number. Everything else is why it is that number.
 */
export class Trace {
  constructor(init) {
    this.id = init.id;
    this.label = init.label;
    this.formula = init.formula || null;
    this.inputs = init.inputs || {};
    this.lines = init.lines || [];
    this.result = init.result;
    this.status = init.status;
    this.rule = init.rule || null;
    this.assumptions = init.assumptions || [];
    this.warnings = init.warnings || [];
    this.limitations = init.limitations || [];
    this.children = init.children || [];
  }

  /** Citations from this trace and everything beneath it, de-duplicated. */
  citations() {
    const seen = new Map();
    const walk = (t) => {
      for (const c of (t.rule?.citations || [])) {
        const key = c.url || `${c.publisher}|${c.title}`;
        if (!seen.has(key)) seen.set(key, c);
      }
      for (const child of t.children) walk(child);
    };
    walk(this);
    return [...seen.values()];
  }

  /** This trace's status combined with every child's. */
  effectiveStatus() {
    return weakestStatus([this.status, ...this.children.map((c) => c.effectiveStatus())]);
  }

  /** Every warning in the tree, with the label of the step that raised it. */
  allWarnings() {
    const out = [];
    const walk = (t) => {
      for (const w of t.warnings) out.push({ step: t.label, message: w });
      for (const c of t.children) walk(c);
    };
    walk(this);
    return out;
  }

  /** Every assumption in the tree. Drives the report's assumptions page. */
  allAssumptions() {
    const out = [];
    const walk = (t) => {
      for (const a of t.assumptions) out.push({ step: t.label, message: a });
      for (const c of t.children) walk(c);
    };
    walk(this);
    return out;
  }

  toJSON() {
    return {
      id: this.id,
      label: this.label,
      formula: this.formula,
      inputs: Object.fromEntries(Object.entries(this.inputs).map(([k, v]) => [k, serialiseValue(v)])),
      lines: this.lines.map((l) => l.toJSON()),
      result: serialiseValue(this.result),
      status: this.status,
      effectiveStatus: this.effectiveStatus(),
      rule: this.rule
        ? {
          id: this.rule.id,
          version: this.rule.version,
          effectiveFrom: this.rule.effectiveFrom,
          effectiveTo: this.rule.effectiveTo,
          taxYear: this.rule.taxYear,
          lastReviewed: this.rule.lastReviewed,
          verification: this.rule.verification,
          citations: this.rule.citations,
        }
        : null,
      assumptions: this.assumptions,
      warnings: this.warnings,
      limitations: this.limitations,
      children: this.children.map((c) => c.toJSON()),
    };
  }
}

/** Fluent builder — keeps rule code readable at the call site. */
export class TraceBuilder {
  constructor(id, label) {
    this._ = {
      id, label, formula: null, inputs: {}, lines: [], result: null,
      status: STATUS.VERIFIED, rule: null,
      assumptions: [], warnings: [], limitations: [], children: [],
    };
  }

  formula(f) { this._.formula = f; return this; }
  input(name, value) { this._.inputs[name] = value; return this; }
  inputs(obj) { Object.assign(this._.inputs, obj); return this; }

  line(spec) { this._.lines.push(new TraceLine(spec)); return this; }

  /** Attach the rule this figure came from; adopts its verification status. */
  fromRule(rule) {
    this._.rule = rule;
    this._.status = rule.verification;
    if (rule.limitations?.length) this._.limitations.push(...rule.limitations);
    return this;
  }

  status(s) {
    if (!STATUS_ORDER.includes(s)) throw new RangeError(`Unknown status ${JSON.stringify(s)}`);
    this._.status = s;
    return this;
  }

  /**
   * The status set so far, for a caller that needs to return it alongside the
   * built trace. Reading `builder._.status` from outside works but couples the
   * caller to the builder's internals, which is how it gets broken later.
   */
  currentStatus() { return this._.status; }

  /** Weaken the status to `s` if `s` is weaker; never strengthen it. */
  atMost(s) {
    this._.status = weakestStatus([this._.status, s]);
    return this;
  }

  assume(message) { this._.assumptions.push(message); return this; }
  warn(message) { this._.warnings.push(message); return this; }
  limitation(message) { this._.limitations.push(message); return this; }
  child(trace) { if (trace) this._.children.push(trace); return this; }

  result(value) { this._.result = value; return this; }

  build() {
    if (this._.result == null) throw new Error(`Trace ${this._.id}: no result set`);
    return new Trace(this._);
  }
}

export const trace = (id, label) => new TraceBuilder(id, label);
