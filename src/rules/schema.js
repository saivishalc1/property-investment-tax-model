/**
 * schema.js — the shape of a tax rule, and strict validation of it.
 *
 * DESIGN INTENT. The previous engine held rates as bare numbers on a preset
 * object: `fedOrdinary: 40`. That representation cannot answer any of the
 * questions a professional actually asks — which law, in force when, for which
 * kind of buyer, checked against what, last looked at on what date, and what
 * it is known not to cover. So it could not be defended, and it could not be
 * safely changed, because nothing recorded what it was supposed to mean.
 *
 * A rule here is a self-describing record. Validation runs at load time and
 * throws, so a malformed rule is a startup failure rather than a wrong number
 * discovered by a client six months later.
 *
 * Rules are DATA. They contain no functions, so they serialise, diff cleanly
 * in review, and can be versioned and shipped without shipping code.
 */

import { Decimal, ROUND } from '../core/decimal.js';
import { CURRENCIES } from '../core/money.js';
import { STATUS } from '../core/trace.js';

/**
 * How a charge is computed from a base amount.
 *
 * The distinction between SLICE and CLIFF is the single most expensive thing
 * to get wrong in transaction tax, so the two are named methods rather than a
 * boolean flag on a shared code path.
 */
export const METHOD = Object.freeze({
  /** Each slice of the base is charged at its own band's rate. UK SDLT,
   *  income tax, Japanese progressive rates. */
  PROGRESSIVE_SLICE: 'PROGRESSIVE_SLICE',

  /** The ENTIRE base is charged at the rate of the highest band it reaches.
   *  One dollar over a threshold re-rates everything. NY mansion tax, NYC
   *  RPTT, and several Japanese and UK supplements behave this way. */
  CLIFF_WHOLE_VALUE: 'CLIFF_WHOLE_VALUE',

  /** A single rate applied to the whole base. */
  FLAT_RATE: 'FLAT_RATE',

  /** A fixed cash amount, selected by which band the base falls in. Japanese
   *  stamp tax works exactly this way. */
  FIXED_AMOUNT: 'FIXED_AMOUNT',

  /** A per-unit charge: rate x quantity (floor area, units). */
  PER_UNIT: 'PER_UNIT',
});

const METHODS = new Set(Object.values(METHOD));

/** Broad category, used for grouping in reports and for rule lookup. */
export const CATEGORY = Object.freeze({
  ACQUISITION_TAX: 'acquisition_tax',
  REGISTRATION_TAX: 'registration_tax',
  STAMP_TAX: 'stamp_tax',
  TRANSFER_TAX: 'transfer_tax',
  SURCHARGE: 'surcharge',
  RECURRING_PROPERTY_TAX: 'recurring_property_tax',
  INCOME_TAX: 'income_tax',
  SURTAX: 'surtax',
  CAPITAL_GAINS_TAX: 'capital_gains_tax',
  DEPRECIATION: 'depreciation',
  RELIEF: 'relief',
  WITHHOLDING: 'withholding',
  CONSUMPTION_TAX: 'consumption_tax',
});

const CATEGORIES = new Set(Object.values(CATEGORY));

/** Who bears the charge. Materially changes a deal's cash at closing. */
export const PAYER = Object.freeze({ BUYER: 'buyer', SELLER: 'seller', OWNER: 'owner' });

/**
 * Which part of a composite charge a rule represents.
 *
 * A single "capital gains tax" bill in Japan is three separate charges levied
 * by two different levels of government: national income tax, the national
 * reconstruction surtax, and local inhabitant tax. They are ADDITIVE, not
 * alternatives. Likewise a UK commercial purchase can attract both a charge on
 * the premium and a separate charge on the net present value of the rent.
 *
 * Rules that are alternatives (resident vs non-resident SDLT) share a component
 * and are separated by applicability. Rules that are components of one bill
 * carry different component values and are all returned together.
 */
export const COMPONENT = Object.freeze({
  /** The whole charge, where there is only one. The default. */
  PRINCIPAL: 'principal',
  NATIONAL: 'national',
  LOCAL: 'local',
  SURTAX: 'surtax',
  /** UK: the charge on the lease premium or purchase price. */
  PREMIUM: 'premium',
  /** UK: the separate charge on the net present value of rent. */
  LEASE_NPV: 'lease-npv',
});

export const PROPERTY_CLASS = Object.freeze({
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  MIXED: 'mixed',
  LAND: 'land',
});

export const OWNERSHIP = Object.freeze({
  INDIVIDUAL: 'individual',
  COMPANY: 'company',
  PARTNERSHIP: 'partnership',
  TRUST: 'trust',
});

export const RESIDENCY = Object.freeze({ RESIDENT: 'resident', NON_RESIDENT: 'non_resident' });

/**
 * Holding-period class, where a jurisdiction charges gains differently by it.
 *
 * Japan's five-year line is the case this exists for. Which side a disposal
 * falls on is decided by jpHoldingPeriodIsLongTerm(), not by this constant —
 * this only lets a rule declare which side it covers.
 */
export const HOLDING_PERIOD = Object.freeze({ SHORT: 'short', LONG: 'long' });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(id, message) {
  throw new Error(`Invalid rule ${id ? `"${id}"` : '(no id)'}: ${message}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate one rule, returning a frozen copy with Decimals parsed.
 *
 * Rates and thresholds are authored as STRINGS in the rule packs, never as JS
 * numbers, so a rate can never arrive already damaged by float parsing. This
 * function is where they become Decimals.
 */
export function defineRule(raw) {
  if (!isPlainObject(raw)) fail(null, 'rule must be an object');
  const id = raw.id;

  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(id)) {
    fail(id, 'id must be a stable lower-case slug (letters, digits, dot, hyphen)');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) fail(id, 'name is required');
  if (typeof raw.version !== 'string' || !raw.version.trim()) fail(id, 'version is required');

  // --- jurisdiction ---------------------------------------------------
  const j = raw.jurisdiction;
  if (!isPlainObject(j)) fail(id, 'jurisdiction is required');
  if (typeof j.country !== 'string' || !/^[A-Z]{2}$/.test(j.country)) {
    fail(id, 'jurisdiction.country must be an ISO 3166-1 alpha-2 code');
  }
  if (j.region != null && typeof j.region !== 'string') fail(id, 'jurisdiction.region must be a string or null');
  if (j.locality != null && typeof j.locality !== 'string') fail(id, 'jurisdiction.locality must be a string or null');

  // --- classification -------------------------------------------------
  if (!CATEGORIES.has(raw.category)) fail(id, `category must be one of ${[...CATEGORIES].join(', ')}`);
  if (!METHODS.has(raw.method)) fail(id, `method must be one of ${[...METHODS].join(', ')}`);
  if (raw.payer != null && !Object.values(PAYER).includes(raw.payer)) fail(id, 'payer must be buyer, seller or owner');

  // --- temporal validity ----------------------------------------------
  if (!ISO_DATE.test(raw.effectiveFrom || '')) fail(id, 'effectiveFrom must be an ISO date (YYYY-MM-DD)');
  if (raw.effectiveTo != null && !ISO_DATE.test(raw.effectiveTo)) fail(id, 'effectiveTo must be an ISO date or null');
  if (raw.effectiveTo != null && raw.effectiveTo < raw.effectiveFrom) fail(id, 'effectiveTo precedes effectiveFrom');
  if (typeof raw.taxYear !== 'string' || !raw.taxYear.trim()) fail(id, 'taxYear is required (e.g. "2025-26" or "2026")');

  // --- currency and rounding ------------------------------------------
  if (!CURRENCIES[raw.currency]) fail(id, `currency ${JSON.stringify(raw.currency)} is not defined in money.js`);
  const rounding = raw.rounding || {};
  const roundScale = rounding.scale ?? CURRENCIES[raw.currency].exponent;
  const roundMode = rounding.mode ?? CURRENCIES[raw.currency].roundingMode;
  if (!Number.isInteger(roundScale) || roundScale < 0) fail(id, 'rounding.scale must be a non-negative integer');
  if (!Object.values(ROUND).includes(roundMode)) fail(id, `rounding.mode ${JSON.stringify(roundMode)} is not a known mode`);
  // Japan rounds in two places and the order matters: the taxable base drops
  // to a whole unit BEFORE the rate is applied, and the resulting tax drops to
  // a (different) whole unit after. Collapsing them into one rounding step
  // gives the wrong answer, so they are separate fields.
  for (const field of ['baseFloorToUnit', 'floorToUnit']) {
    if (rounding[field] != null) {
      const u = safeDecimal(id, rounding[field], `rounding.${field}`);
      if (!u.isPositive()) fail(id, `rounding.${field} must be positive`);
    }
  }

  // --- provenance -------------------------------------------------------
  if (!Array.isArray(raw.citations) || raw.citations.length === 0) {
    fail(id, 'at least one citation is required — a rate nobody can trace is a rate nobody can defend');
  }
  const citations = raw.citations.map((c, i) => {
    if (!isPlainObject(c)) fail(id, `citations[${i}] must be an object`);
    if (typeof c.title !== 'string' || !c.title.trim()) fail(id, `citations[${i}].title is required`);
    if (typeof c.publisher !== 'string' || !c.publisher.trim()) fail(id, `citations[${i}].publisher is required`);
    if (c.url != null && !/^https?:\/\//.test(c.url)) fail(id, `citations[${i}].url must be http(s) or null`);
    if (!ISO_DATE.test(c.accessed || '')) fail(id, `citations[${i}].accessed must be an ISO date`);
    if (typeof c.primary !== 'boolean') fail(id, `citations[${i}].primary must be true or false`);
    return Object.freeze({ ...c });
  });

  if (!ISO_DATE.test(raw.lastReviewed || '')) fail(id, 'lastReviewed must be an ISO date');
  if (!Object.values(STATUS).includes(raw.verification)) {
    fail(id, `verification must be one of ${Object.values(STATUS).join(', ')}`);
  }
  // A rule may only claim VERIFIED if a primary source backs it. This is
  // enforced mechanically so the honest-status guarantee cannot rot.
  if (raw.verification === STATUS.VERIFIED && !citations.some((c) => c.primary)) {
    fail(id, 'verification "verified" requires at least one citation marked primary:true');
  }

  const limitations = raw.limitations || [];
  if (!Array.isArray(limitations) || limitations.some((l) => typeof l !== 'string')) {
    fail(id, 'limitations must be an array of strings');
  }

  // --- the arithmetic ---------------------------------------------------
  const bands = validateBands(id, raw);

  const applicability = Object.freeze({
    propertyClass: freezeList(id, raw.applicability?.propertyClass, PROPERTY_CLASS, 'propertyClass'),
    ownership: freezeList(id, raw.applicability?.ownership, OWNERSHIP, 'ownership'),
    residency: freezeList(id, raw.applicability?.residency, RESIDENCY, 'residency'),
    holdingPeriod: freezeList(id, raw.applicability?.holdingPeriod, HOLDING_PERIOD, 'holdingPeriod'),
    filingStatus: raw.applicability?.filingStatus ? Object.freeze([...raw.applicability.filingStatus]) : null,
  });

  const component = raw.component ?? COMPONENT.PRINCIPAL;
  if (!Object.values(COMPONENT).includes(component)) {
    fail(id, `component must be one of ${Object.values(COMPONENT).join(', ')}`);
  }

  return Object.freeze({
    id,
    name: raw.name,
    version: raw.version,
    description: raw.description || null,
    jurisdiction: Object.freeze({ country: j.country, region: j.region ?? null, locality: j.locality ?? null }),
    category: raw.category,
    component,
    method: raw.method,
    payer: raw.payer ?? null,
    taxYear: raw.taxYear,
    effectiveFrom: raw.effectiveFrom,
    effectiveTo: raw.effectiveTo ?? null,
    currency: raw.currency,
    rounding: Object.freeze({
      scale: roundScale,
      mode: roundMode,
      baseFloorToUnit: rounding.baseFloorToUnit != null ? String(rounding.baseFloorToUnit) : null,
      floorToUnit: rounding.floorToUnit != null ? String(rounding.floorToUnit) : null,
    }),
    bands,
    /** Optional cap on the computed charge, as a Decimal in major units. */
    cap: raw.cap != null ? safeDecimal(id, raw.cap, 'cap') : null,
    /** Optional floor below which no charge arises at all. */
    exemptBelow: raw.exemptBelow != null ? safeDecimal(id, raw.exemptBelow, 'exemptBelow') : null,
    applicability,
    citations: Object.freeze(citations),
    lastReviewed: raw.lastReviewed,
    verification: raw.verification,
    limitations: Object.freeze([...limitations]),
    notes: raw.notes || null,
  });
}

function freezeList(id, value, allowed, field) {
  if (value == null) return null; // null means "applies to all"
  if (!Array.isArray(value) || value.length === 0) fail(id, `applicability.${field} must be a non-empty array or omitted`);
  const allowedValues = new Set(Object.values(allowed));
  for (const v of value) {
    if (!allowedValues.has(v)) fail(id, `applicability.${field} contains unknown value ${JSON.stringify(v)}`);
  }
  return Object.freeze([...value]);
}

function safeDecimal(id, value, field) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail(id, `${field} must be a string (preferred) or number`);
  }
  try {
    return Decimal.of(typeof value === 'number' ? String(value) : value);
  } catch (e) {
    fail(id, `${field} is not a valid decimal: ${e.message}`);
  }
  return null;
}

/**
 * Validate and normalise the band table.
 *
 * Bands are authored ascending by `from` (an inclusive lower bound). The
 * validator rejects unsorted or duplicated thresholds rather than silently
 * sorting them, because a mis-ordered band table in a rule pack is a mistake
 * somebody made and should have to look at, not something to paper over.
 */
function validateBands(id, raw) {
  const { method } = raw;

  if (method === METHOD.FLAT_RATE) {
    if (raw.rate == null) fail(id, 'FLAT_RATE requires `rate`');
    const rate = safeDecimal(id, raw.rate, 'rate');
    return Object.freeze([Object.freeze({ from: Decimal.of(0), rate, amount: null, label: raw.rateLabel || null })]);
  }

  if (method === METHOD.PER_UNIT) {
    if (raw.rate == null) fail(id, 'PER_UNIT requires `rate` (charge per unit)');
    const rate = safeDecimal(id, raw.rate, 'rate');
    return Object.freeze([Object.freeze({ from: Decimal.of(0), rate, amount: null, label: raw.rateLabel || null })]);
  }

  if (!Array.isArray(raw.bands) || raw.bands.length === 0) fail(id, `${method} requires a non-empty bands array`);

  let previous = null;
  const bands = raw.bands.map((b, i) => {
    if (!isPlainObject(b)) fail(id, `bands[${i}] must be an object`);
    const from = safeDecimal(id, b.from ?? '0', `bands[${i}].from`);
    if (from.isNegative()) fail(id, `bands[${i}].from must not be negative`);
    if (previous !== null && from.lte(previous)) {
      fail(id, `bands[${i}].from (${from}) must be strictly greater than the previous band's from (${previous})`);
    }
    previous = from;

    if (method === METHOD.FIXED_AMOUNT) {
      if (b.amount == null) fail(id, `bands[${i}].amount is required for FIXED_AMOUNT`);
      return Object.freeze({ from, rate: null, amount: safeDecimal(id, b.amount, `bands[${i}].amount`), label: b.label || null });
    }
    if (b.rate == null) fail(id, `bands[${i}].rate is required for ${method}`);
    return Object.freeze({ from, rate: safeDecimal(id, b.rate, `bands[${i}].rate`), amount: null, label: b.label || null });
  });

  if (!bands[0].from.isZero()) {
    fail(id, 'the first band must start at 0 — otherwise the charge below it is undefined rather than nil');
  }
  return Object.freeze(bands);
}

/** True if `rule` is in force on ISO date `on`. */
export function isInForce(rule, on) {
  if (!ISO_DATE.test(on)) throw new RangeError(`isInForce: date must be YYYY-MM-DD, got ${JSON.stringify(on)}`);
  if (on < rule.effectiveFrom) return false;
  if (rule.effectiveTo != null && on > rule.effectiveTo) return false;
  return true;
}

/** True if `rule` covers the given facts. A null applicability list means all. */
export function appliesTo(rule, facts) {
  const a = rule.applicability;
  if (a.propertyClass && facts.propertyClass && !a.propertyClass.includes(facts.propertyClass)) return false;
  if (a.ownership && facts.ownership && !a.ownership.includes(facts.ownership)) return false;
  if (a.residency && facts.residency && !a.residency.includes(facts.residency)) return false;
  if (a.holdingPeriod && facts.holdingPeriod && !a.holdingPeriod.includes(facts.holdingPeriod)) return false;
  if (a.filingStatus && facts.filingStatus && !a.filingStatus.includes(facts.filingStatus)) return false;
  return true;
}

/** How specifically a rule matches — higher wins when several are in force. */
export function specificity(rule) {
  let s = 0;
  if (rule.jurisdiction.region) s += 2;
  if (rule.jurisdiction.locality) s += 4;
  const a = rule.applicability;
  if (a.propertyClass) s += 1;
  if (a.ownership) s += 1;
  if (a.residency) s += 1;
  if (a.holdingPeriod) s += 1;
  if (a.filingStatus) s += 1;
  return s;
}
