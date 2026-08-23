/**
 * money.js — currency-aware money built on the exact Decimal core.
 *
 * WHAT THIS FIXES. The previous engine carried currency as a display prefix
 * ("¥", "£") on a rates object and nothing more. Every amount was an untyped
 * JS number, so nothing prevented a yen figure being added to a pound figure,
 * and nothing knew that yen has no minor unit. Rounding a JPY amount to two
 * decimal places produces a figure that cannot exist and that no Japanese tax
 * form will accept.
 *
 * Money here is an amount plus a currency, and arithmetic between different
 * currencies throws rather than silently producing a meaningless number. There
 * is deliberately NO exchange-rate conversion in this module: a planning model
 * that silently converts currencies hides an assumption (which rate, on which
 * date) that materially changes the answer. Cross-currency work must be an
 * explicit, traced step elsewhere.
 *
 * Minor units follow ISO 4217:
 *   USD, GBP  exponent 2  (cents, pence)
 *   JPY       exponent 0  (yen is indivisible; there is no sen in circulation)
 */

import { Decimal, D, ROUND } from './decimal.js';

/**
 * Currency definitions.
 *
 * `exponent` is the ISO 4217 minor-unit count and drives every rounding
 * boundary. `roundingMode` is the default for presentation and for the final
 * rounding of a computed figure; individual tax rules override it where the
 * statute specifies something else (UK SDLT truncates, several Japanese taxes
 * discard fractions below 1,000 yen).
 */
export const CURRENCIES = Object.freeze({
  USD: Object.freeze({
    code: 'USD', exponent: 2, symbol: '$', symbolPosition: 'prefix',
    locale: 'en-US', name: 'US dollar', roundingMode: ROUND.HALF_UP,
  }),
  GBP: Object.freeze({
    code: 'GBP', exponent: 2, symbol: '£', symbolPosition: 'prefix',
    locale: 'en-GB', name: 'Pound sterling', roundingMode: ROUND.HALF_UP,
  }),
  JPY: Object.freeze({
    code: 'JPY', exponent: 0, symbol: '¥', symbolPosition: 'prefix',
    locale: 'ja-JP', name: 'Japanese yen', roundingMode: ROUND.DOWN,
  }),
});

export function currencyOf(code) {
  const c = CURRENCIES[code];
  if (!c) throw new RangeError(`Unknown currency: ${JSON.stringify(code)}`);
  return c;
}

export class Money {
  /** @type {Decimal} */
  #amount;
  /** @type {string} ISO 4217 code */
  #code;

  constructor(amount, code) {
    this.#amount = amount;
    this.#code = code;
    Object.freeze(this);
  }

  /**
   * Construct from any Decimal-compatible value.
   *
   * The amount is NOT rounded to the currency's minor unit here. Intermediate
   * results legitimately carry more precision than the minor unit — an
   * amortisation schedule computed at penny precision at every step drifts
   * from one computed exactly and rounded once at the end. Call `.quantize()`
   * at the point a figure becomes a reportable amount.
   */
  static of(value, code) {
    currencyOf(code);
    return new Money(Decimal.of(value), code);
  }

  static zero(code) { return Money.of(0, code); }

  get amount() { return this.#amount; }
  get currency() { return this.#code; }
  get definition() { return currencyOf(this.#code); }

  #assertSame(other, op) {
    if (!(other instanceof Money)) {
      throw new TypeError(`Money.${op}: expected Money, got ${typeof other}`);
    }
    if (other.currency !== this.#code) {
      throw new TypeError(
        `Money.${op}: currency mismatch ${this.#code} vs ${other.currency}. ` +
        'Cross-currency arithmetic must be an explicit, traced conversion.',
      );
    }
  }

  add(other) { this.#assertSame(other, 'add'); return new Money(this.#amount.add(other.amount), this.#code); }
  subtract(other) { this.#assertSame(other, 'subtract'); return new Money(this.#amount.subtract(other.amount), this.#code); }

  /** Scale by a dimensionless factor (a rate, a fraction, a count). */
  multiply(factor) { return new Money(this.#amount.multiply(Decimal.of(factor)), this.#code); }

  /** Divide by a dimensionless factor. Scale and mode are mandatory. */
  divide(divisor, scale, mode) {
    return new Money(this.#amount.divide(Decimal.of(divisor), scale, mode), this.#code);
  }

  /** Ratio of two Money values in the same currency — a dimensionless Decimal. */
  ratioTo(other, scale, mode) {
    this.#assertSame(other, 'ratioTo');
    return this.#amount.divide(other.amount, scale, mode);
  }

  negate() { return new Money(this.#amount.negate(), this.#code); }
  abs() { return new Money(this.#amount.abs(), this.#code); }

  isZero() { return this.#amount.isZero(); }
  isNegative() { return this.#amount.isNegative(); }
  isPositive() { return this.#amount.isPositive(); }

  compare(other) { this.#assertSame(other, 'compare'); return this.#amount.compare(other.amount); }
  equals(other) { return other instanceof Money && other.currency === this.#code && this.#amount.equals(other.amount); }
  lt(other) { return this.compare(other) < 0; }
  lte(other) { return this.compare(other) <= 0; }
  gt(other) { return this.compare(other) > 0; }
  gte(other) { return this.compare(other) >= 0; }

  max(other) { this.#assertSame(other, 'max'); return this.compare(other) >= 0 ? this : other; }
  min(other) { this.#assertSame(other, 'min'); return this.compare(other) <= 0 ? this : other; }

  /** Floor at zero. The "tax is never negative" guard used across the rules. */
  clampLow() { return this.isNegative() ? Money.zero(this.#code) : this; }

  /**
   * Round to the currency's minor unit — the point where a working figure
   * becomes a reportable amount. A rule may pass its own statutory mode.
   */
  quantize(mode) {
    const def = this.definition;
    return new Money(this.#amount.rescale(def.exponent, mode || def.roundingMode), this.#code);
  }

  /**
   * Round down to a whole multiple of `unit` (in major currency units).
   *
   * Japanese tax statutes repeatedly discard fractions below a stated unit —
   * taxable acquisition values drop to the nearest 1,000 yen, several tax
   * amounts to the nearest 100 yen. Doing that with a generic rounding helper
   * loses the intent, so it gets its own named operation.
   */
  floorToUnit(unit) {
    const u = Decimal.of(unit);
    if (!u.isPositive()) throw new RangeError('floorToUnit: unit must be positive');
    const multiples = this.#amount.divide(u, 0, ROUND.FLOOR);
    return new Money(multiples.multiply(u), this.#code);
  }

  /**
   * Split into `n` parts that sum exactly back to this amount.
   *
   * Naive division loses or invents minor units (100.00 / 3 = 33.33 x 3 =
   * 99.99). The remainder is distributed one minor unit at a time so the parts
   * always reconcile — which matters anywhere a total is shown alongside its
   * components and a reader can add them up.
   */
  allocate(n) {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError('allocate: n must be a positive integer');
    const def = this.definition;
    const q = this.quantize(ROUND.DOWN);
    // Work in whole minor units so the remainder is an exact integer count.
    const totalMinor = q.amount.multiply(pow10Decimal(def.exponent)).rescale(0, ROUND.DOWN).unscaled;
    const base = totalMinor / BigInt(n);
    let remainder = totalMinor - base * BigInt(n);
    const step = remainder < 0n ? -1n : 1n;
    if (remainder < 0n) remainder = -remainder;

    const out = [];
    for (let i = 0; i < n; i++) {
      let part = base;
      if (remainder > 0n) { part += step; remainder -= 1n; }
      out.push(new Money(new Decimal(part, def.exponent), this.#code));
    }
    return out;
  }

  toString() { return `${this.#amount.toString()} ${this.#code}`; }
  toJSON() { return { amount: this.#amount.toString(), currency: this.#code }; }

  /** Rehydrate from toJSON output. Used by scenario import and migration. */
  static fromJSON(o) {
    if (!o || typeof o !== 'object') throw new TypeError('Money.fromJSON: expected an object');
    return Money.of(o.amount, o.currency);
  }
}

function pow10Decimal(n) { return Decimal.of('1' + '0'.repeat(n)); }

/** Sum a list of Money. An empty list needs a currency, so it must be given. */
export function sumMoney(values, code) {
  let acc = Money.zero(code);
  for (const v of values) acc = acc.add(v);
  return acc;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ *
 * Intl.NumberFormat is used for grouping and symbol placement because it is
 * built into the runtime and gets locale conventions right. It takes a Number,
 * which is lossy — acceptable HERE and only here, because this is the display
 * boundary and the value has already been quantised to the minor unit. No
 * formatted string is ever parsed back into the engine.
 */

const FORMAT_CACHE = new Map();

function formatter(code, opts) {
  const key = `${code}|${JSON.stringify(opts)}`;
  let f = FORMAT_CACHE.get(key);
  if (!f) { f = new Intl.NumberFormat(currencyOf(code).locale, opts); FORMAT_CACHE.set(key, f); }
  return f;
}

/**
 * Format money for display in its own currency's convention.
 *
 * JPY renders with no decimal places and a yen symbol; GBP with two and a
 * pound sign; USD with two and a dollar sign. The caller never has to know
 * which — that is the whole point of carrying the currency with the amount.
 */
export function formatMoney(money, { compact = false, showCode = false } = {}) {
  if (!(money instanceof Money)) throw new TypeError('formatMoney: expected Money');
  const def = money.definition;
  const q = money.quantize();
  const n = q.amount.toNumberLossy();

  const opts = {
    style: 'currency',
    currency: def.code,
    minimumFractionDigits: def.exponent,
    maximumFractionDigits: def.exponent,
  };
  if (compact) {
    opts.notation = 'compact';
    opts.maximumFractionDigits = 1;
    delete opts.minimumFractionDigits;
  }
  const s = formatter(def.code, opts).format(n);
  return showCode ? `${s} ${def.code}` : s;
}

/** Format a dimensionless Decimal as a percentage string. */
export function formatPercent(decimalValue, places = 2) {
  const d = Decimal.of(decimalValue).rescale(places, ROUND.HALF_UP);
  return `${d.toString()}%`;
}

/** Parse user-entered money text into Money, or throw with a useful message. */
export function parseMoneyInput(text, code) {
  const def = currencyOf(code);
  const cleaned = String(text)
    .replace(/[\s  ]/g, '')
    .replace(new RegExp(`[${escapeForClass(def.symbol)}]`, 'g'), '')
    .replace(/,/g, '');
  if (cleaned === '') throw new SyntaxError('empty');
  return Money.of(Decimal.parse(cleaned), code);
}

function escapeForClass(s) { return s.replace(/[\\\]^-]/g, '\\$&'); }
