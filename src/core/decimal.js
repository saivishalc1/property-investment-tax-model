/**
 * decimal.js — exact fixed-point decimal arithmetic on BigInt.
 *
 * WHY THIS EXISTS. A tax engine cannot use binary floating point for money or
 * for threshold comparisons. Two failures matter and both are silent:
 *
 *   Money drift.     0.1 + 0.2 === 0.30000000000000004. Compounded across a
 *                    thirty-year amortisation schedule the error is small but
 *                    it is not zero, and it lands in a number a client checks.
 *
 *   Threshold flips. This is the dangerous one. Transfer taxes are decided by
 *                    cliff thresholds — one penny over GBP 250,000 re-rates the
 *                    whole transaction. If a price arrives as 250000.00000001
 *                    because it was derived by multiplication, the taxpayer is
 *                    handed a bill from the wrong band. Floating point turns a
 *                    legal boundary into a coin toss.
 *
 * The representation is an unscaled BigInt plus a decimal scale, so 12.345 is
 * { unscaled: 12345n, scale: 3 }. Addition, subtraction and multiplication are
 * exact and never round. Division cannot be exact in general, so it REQUIRES an
 * explicit scale and rounding mode at every call site — there is no default,
 * because a silent default rounding rule is exactly the kind of invisible
 * assumption this project is meant to eliminate.
 *
 * No dependencies. This is deliberate: the calculation engine must run offline
 * with no supply chain, and rounding semantics are something we need to own
 * rather than inherit.
 */

/** Rounding modes. Names follow ISO 80000-1 / IEEE 754 conventions. */
export const ROUND = Object.freeze({
  /** Toward +infinity. */
  CEIL: 'CEIL',
  /** Toward -infinity. */
  FLOOR: 'FLOOR',
  /** Toward zero (truncate). Several UK and Japanese figures truncate. */
  DOWN: 'DOWN',
  /** Away from zero. */
  UP: 'UP',
  /** Nearest; ties away from zero. The common commercial default. */
  HALF_UP: 'HALF_UP',
  /** Nearest; ties toward zero. */
  HALF_DOWN: 'HALF_DOWN',
  /** Nearest; ties to even. Banker's rounding — unbiased over many roundings. */
  HALF_EVEN: 'HALF_EVEN',
});

const ROUND_MODES = new Set(Object.values(ROUND));

/** 10n ** n, memoised — this is the hot path in every scale alignment. */
const POW10 = [1n];
function pow10(n) {
  if (n < 0) throw new RangeError(`pow10: negative exponent ${n}`);
  while (POW10.length <= n) POW10.push(POW10[POW10.length - 1] * 10n);
  return POW10[n];
}

/**
 * Guard against a scale large enough to turn an accidental loop into a
 * memory-exhaustion bug. Real tax arithmetic never needs anything close to
 * this; 40 digits past the point is already far beyond any statute.
 */
const MAX_SCALE = 40;

function assertScale(scale, where) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`${where}: scale must be an integer in [0, ${MAX_SCALE}], got ${scale}`);
  }
}

/** Matches an optionally-signed decimal literal, with or without an exponent. */
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export class Decimal {
  /** @type {bigint} unscaled value */
  #u;
  /** @type {number} digits after the decimal point */
  #s;

  /** Use Decimal.of(). The constructor is unchecked and internal. */
  constructor(unscaled, scale) {
    this.#u = unscaled;
    this.#s = scale;
    Object.freeze(this);
  }

  /**
   * Build a Decimal from a string, Number, bigint, or another Decimal.
   *
   * Non-integer Numbers are accepted but routed through their shortest
   * round-trip string form, which is what the user typed in every realistic
   * case (0.1 parses as exactly 0.1, not as the binary value near it). Prefer
   * strings at every boundary where the value came from a person or a file.
   */
  static of(value, scale) {
    let d;
    if (value instanceof Decimal) d = value;
    else if (typeof value === 'bigint') d = new Decimal(value, 0);
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`Decimal.of: non-finite number ${value}`);
      d = Decimal.parse(String(value));
    } else if (typeof value === 'string') d = Decimal.parse(value);
    else throw new TypeError(`Decimal.of: unsupported type ${typeof value}`);
    return scale === undefined ? d : d.rescale(scale, ROUND.HALF_EVEN);
  }

  /** Parse a decimal string. Throws on anything that is not clearly a number. */
  static parse(text) {
    const t = String(text).trim();
    if (!DECIMAL_RE.test(t)) {
      throw new SyntaxError(`Decimal.parse: not a decimal literal: ${JSON.stringify(text)}`);
    }

    const parts = t.split(/[eE]/);
    let mantissa = parts[0];
    const exp = parts[1] ? parseInt(parts[1], 10) : 0;

    let sign = 1n;
    if (mantissa[0] === '+') mantissa = mantissa.slice(1);
    else if (mantissa[0] === '-') { sign = -1n; mantissa = mantissa.slice(1); }

    const dot = mantissa.indexOf('.');
    let digits, scale;
    if (dot === -1) { digits = mantissa; scale = 0; }
    else { digits = mantissa.slice(0, dot) + mantissa.slice(dot + 1); scale = mantissa.length - dot - 1; }

    scale -= exp;
    let unscaled = sign * BigInt(digits === '' ? '0' : digits);

    // A negative scale means the exponent pushed digits above the point.
    if (scale < 0) { unscaled *= pow10(-scale); scale = 0; }
    assertScale(scale, 'Decimal.parse');
    return new Decimal(unscaled, scale);
  }

  static get ZERO() { return ZERO; }
  static get ONE() { return ONE; }

  get unscaled() { return this.#u; }
  get scale() { return this.#s; }

  isZero() { return this.#u === 0n; }
  isNegative() { return this.#u < 0n; }
  isPositive() { return this.#u > 0n; }
  signum() { return this.#u === 0n ? 0 : (this.#u < 0n ? -1 : 1); }

  negate() { return new Decimal(-this.#u, this.#s); }
  abs() { return this.#u < 0n ? this.negate() : this; }

  /** Re-express at a different scale, rounding if digits are lost. */
  rescale(scale, mode) {
    assertScale(scale, 'rescale');
    if (scale === this.#s) return this;
    if (scale > this.#s) return new Decimal(this.#u * pow10(scale - this.#s), scale);
    return new Decimal(
      divideRounded(this.#u, pow10(this.#s - scale), requireMode(mode, 'rescale')),
      scale,
    );
  }

  /** Exact. Result scale is max(a, b). */
  add(other) {
    const o = Decimal.of(other);
    const s = Math.max(this.#s, o.scale);
    return new Decimal(this.#u * pow10(s - this.#s) + o.unscaled * pow10(s - o.scale), s);
  }

  /** Exact. Result scale is max(a, b). */
  subtract(other) { return this.add(Decimal.of(other).negate()); }

  /** Exact. Result scale is a.scale + b.scale. */
  multiply(other) {
    const o = Decimal.of(other);
    const s = this.#s + o.scale;
    if (s > MAX_SCALE) {
      // MAX_SCALE digits is far past any statutory precision, and refusing
      // outright would break legitimate chained arithmetic.
      return new Decimal(this.#u * o.unscaled, s).rescale(MAX_SCALE, ROUND.HALF_EVEN);
    }
    return new Decimal(this.#u * o.unscaled, s);
  }

  /**
   * Divide. Scale and rounding mode are mandatory — division is where a tax
   * engine silently invents precision, so the call site must state its intent.
   */
  divide(other, scale, mode) {
    assertScale(scale, 'divide');
    const o = Decimal.of(other);
    if (o.isZero()) throw new RangeError('Decimal.divide: division by zero');
    // (u1 / 10^s1) / (u2 / 10^s2) at target scale =
    //   u1 * 10^(s2 + scale) / (u2 * 10^s1)
    const numerator = this.#u * pow10(o.scale + scale);
    const denominator = o.unscaled * pow10(this.#s);
    return new Decimal(divideRounded(numerator, denominator, requireMode(mode, 'divide')), scale);
  }

  /** Compare. Returns -1, 0 or 1. Exact at any scale. */
  compare(other) {
    const o = Decimal.of(other);
    const s = Math.max(this.#s, o.scale);
    const a = this.#u * pow10(s - this.#s);
    const b = o.unscaled * pow10(s - o.scale);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other) { return this.compare(other) === 0; }
  lt(other) { return this.compare(other) < 0; }
  lte(other) { return this.compare(other) <= 0; }
  gt(other) { return this.compare(other) > 0; }
  gte(other) { return this.compare(other) >= 0; }

  /** The larger/smaller of two values, preserving exactness. */
  max(other) { const o = Decimal.of(other); return this.compare(o) >= 0 ? this : o; }
  min(other) { const o = Decimal.of(other); return this.compare(o) <= 0 ? this : o; }

  /** Clamp below — the "no negative tax" guard, written once. */
  clampLow(floorValue = ZERO) { return this.max(Decimal.of(floorValue)); }

  /** Drop trailing zeros without changing value. Display only. */
  normalize() {
    if (this.#u === 0n) return ZERO;
    let u = this.#u;
    let s = this.#s;
    while (s > 0 && u % 10n === 0n) { u /= 10n; s--; }
    return new Decimal(u, s);
  }

  toString() {
    const neg = this.#u < 0n;
    let digits = (neg ? -this.#u : this.#u).toString();
    if (this.#s === 0) return (neg ? '-' : '') + digits;
    if (digits.length <= this.#s) digits = digits.padStart(this.#s + 1, '0');
    const whole = digits.slice(0, digits.length - this.#s);
    const frac = digits.slice(digits.length - this.#s);
    return `${neg ? '-' : ''}${whole}.${frac}`;
  }

  toJSON() { return this.toString(); }

  /**
   * Lossy conversion to a JS number.
   *
   * Named to be uncomfortable on purpose. It is correct for chart coordinates
   * and layout, and wrong for anything that feeds a tax figure back into the
   * engine. Nothing in the rule layer may call this.
   */
  toNumberLossy() { return Number(this.toString()); }
}

const ZERO = new Decimal(0n, 0);
const ONE = new Decimal(1n, 0);

function requireMode(mode, where) {
  if (!ROUND_MODES.has(mode)) {
    throw new TypeError(`${where}: an explicit rounding mode is required, got ${JSON.stringify(mode)}`);
  }
  return mode;
}

/**
 * Integer division of BigInts under a rounding mode.
 *
 * BigInt division truncates toward zero, so every mode is expressed as a
 * correction applied to that truncated quotient using the doubled remainder,
 * which keeps floating point out of the comparison entirely.
 */
function divideRounded(numerator, denominator, mode) {
  if (denominator === 0n) throw new RangeError('divideRounded: division by zero');

  // Normalise so the sign lives in one place and the remainder is non-negative.
  let n = numerator;
  let d = denominator;
  let negative = false;
  if (d < 0n) { d = -d; n = -n; }
  if (n < 0n) { negative = true; n = -n; }

  const q = n / d;
  const r = n % d;
  if (r === 0n) return negative ? -q : q;

  const twice = r * 2n;
  let bump; // whether to move away from zero by one unit

  switch (mode) {
    case ROUND.DOWN: bump = false; break;
    case ROUND.UP: bump = true; break;
    case ROUND.CEIL: bump = !negative; break;
    case ROUND.FLOOR: bump = negative; break;
    case ROUND.HALF_UP: bump = twice >= d; break;
    case ROUND.HALF_DOWN: bump = twice > d; break;
    case ROUND.HALF_EVEN:
      if (twice > d) bump = true;
      else if (twice < d) bump = false;
      else bump = (q % 2n) !== 0n; // exact tie: round to the even neighbour
      break;
    default: throw new TypeError(`divideRounded: unknown mode ${mode}`);
  }

  const out = bump ? q + 1n : q;
  return negative ? -out : out;
}

/** Convenience constructor: D('12.34'). */
export const D = (v, scale) => Decimal.of(v, scale);

/** Sum a list exactly. An empty list is zero, not NaN. */
export function sum(values) {
  let acc = ZERO;
  for (const v of values) acc = acc.add(Decimal.of(v));
  return acc;
}
