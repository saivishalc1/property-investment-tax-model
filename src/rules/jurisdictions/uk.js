/**
 * uk.js — United Kingdom rule pack.
 *
 * SCOPE AND HONESTY. The United Kingdom is not one property-tax jurisdiction
 * and modelling it as one is the mistake this pack exists to avoid. Land
 * transaction tax is fully devolved:
 *
 *   England & Northern Ireland   Stamp Duty Land Tax (SDLT)      — HMRC
 *   Scotland                     Land and Buildings Transaction
 *                                Tax (LBTT)                      — Revenue Scotland
 *   Wales                        Land Transaction Tax (LTT)      — Welsh Revenue Authority
 *
 * Income tax is partly devolved too: Scotland sets its own non-savings rates
 * and bands. Wales has the power but currently matches the rest of the UK.
 *
 * This file covers ENGLAND & NORTHERN IRELAND and the UK-wide taxes. Scotland
 * and Wales are declared in the registry as known-unsupported rather than
 * silently served the English tables, because serving an English SDLT figure
 * to somebody buying in Glasgow is worse than refusing to answer.
 *
 * ALL FIGURES: tax year 2026-27 (6 April 2026 to 5 April 2027).
 * ALL SOURCES: gov.uk, read directly 2026-08-23. URLs on each rule.
 */

import { defineRule, METHOD, CATEGORY, PAYER, PROPERTY_CLASS, OWNERSHIP, RESIDENCY, COMPONENT } from '../schema.js';
import { STATUS } from '../../core/trace.js';

const ACCESSED = '2026-08-23';
const REVIEWED = '2026-08-23';
const TAX_YEAR = '2026-27';
/** 6 April 2026 — the start of the UK tax year these figures belong to. */
const FROM = '2026-04-06';
/** SDLT thresholds run on the tax-year boundary of 1 April for transactions. */
const SDLT_FROM = '2025-04-01';

const cite = (title, url, primary = true) => ({
  title, publisher: 'HM Revenue & Customs (GOV.UK)', url, accessed: ACCESSED, primary,
});

const SDLT_URL = 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates';
const SDLT_NONRES_URL = 'https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates';
const CGT_URL = 'https://www.gov.uk/capital-gains-tax/rates';
const INCOME_URL = 'https://www.gov.uk/income-tax-rates';

/**
 * Base SDLT residential bands for a buyer who will own only this property.
 * Source: SDLT_URL, "Rates for a single property".
 */
const SDLT_RESIDENTIAL_BASE = [
  { from: '0', rate: '0', label: 'Up to £125,000' },
  { from: '125000', rate: '2', label: '£125,001 to £250,000' },
  { from: '250000', rate: '5', label: '£250,001 to £925,000' },
  { from: '925000', rate: '10', label: '£925,001 to £1,500,000' },
  { from: '1500000', rate: '12', label: 'Above £1,500,000' },
];

/**
 * Add a flat surcharge to every band.
 *
 * The higher rates for additional dwellings and the non-resident surcharge are
 * both expressed by HMRC as "X% on top of the standard rates", applying to
 * every band including the nil-rate one. Deriving the table rather than
 * transcribing it means the surcharged tables cannot drift from the base when
 * a threshold moves in a future Budget.
 */
function withSurcharge(bands, pct, labelSuffix) {
  return bands.map((b) => ({
    from: b.from,
    rate: String(Number(b.rate) + Number(pct)),
    label: labelSuffix ? `${b.label} (${labelSuffix})` : b.label,
  }));
}

const SDLT_LIMITATIONS = [
  'Linked transactions, Multiple Dwellings Relief successors, and purchases of six or more dwellings are not modelled.',
  'Relief claims other than first-time buyers relief are not modelled.',
  'Leasehold net-present-value charges on rent are modelled separately and only for non-residential leases.',
];

/* ------------------------------------------------------------------ *
 * SDLT — England & Northern Ireland
 * ------------------------------------------------------------------ */

export const SDLT_RESIDENTIAL_STANDARD = defineRule({
  id: 'gb-eaw.sdlt.residential.standard',
  name: 'SDLT — residential, sole property',
  version: '2025-04-01',
  description: 'Standard residential rates where the buyer will own no other residential property.',
  jurisdiction: { country: 'GB', region: 'GB-EAW' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: SDLT_FROM,
  effectiveTo: null,
  currency: 'GBP',
  // SDLT is calculated in whole pounds and the charge is rounded down.
  rounding: { scale: 0, mode: 'DOWN' },
  bands: SDLT_RESIDENTIAL_BASE,
  applicability: {
    propertyClass: [PROPERTY_CLASS.RESIDENTIAL],
    residency: [RESIDENCY.RESIDENT],
    ownership: [OWNERSHIP.INDIVIDUAL],
  },
  citations: [cite('Stamp Duty Land Tax: Residential property rates', SDLT_URL)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: SDLT_LIMITATIONS,
});

export const SDLT_RESIDENTIAL_ADDITIONAL = defineRule({
  id: 'gb-eaw.sdlt.residential.additional',
  name: 'SDLT — residential, additional property (higher rates)',
  version: '2025-04-01',
  description: 'Higher rates: 5 percentage points above the standard rates where the purchase means the buyer owns more than one residential property. This is the normal case for a buy-to-let investor.',
  jurisdiction: { country: 'GB', region: 'GB-EAW' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: SDLT_FROM,
  effectiveTo: null,
  currency: 'GBP',
  rounding: { scale: 0, mode: 'DOWN' },
  bands: withSurcharge(SDLT_RESIDENTIAL_BASE, 5, '+5% higher rate'),
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL], residency: [RESIDENCY.RESIDENT] },
  citations: [
    cite('Stamp Duty Land Tax: Residential property rates — Higher rates for additional properties', SDLT_URL),
  ],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ...SDLT_LIMITATIONS,
    'The higher rates can be refunded if the purchase replaced a main residence sold within 36 months. Refund eligibility is not modelled.',
  ],
});

export const SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT = defineRule({
  id: 'gb-eaw.sdlt.residential.additional-nonresident',
  name: 'SDLT — residential, additional property, non-UK resident',
  version: '2025-04-01',
  description: 'Higher rates plus the 2% non-resident surcharge: 7 percentage points above the standard rates.',
  jurisdiction: { country: 'GB', region: 'GB-EAW' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: SDLT_FROM,
  effectiveTo: null,
  currency: 'GBP',
  rounding: { scale: 0, mode: 'DOWN' },
  bands: withSurcharge(SDLT_RESIDENTIAL_BASE, 7, '+5% higher rate, +2% non-resident'),
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL], residency: [RESIDENCY.NON_RESIDENT] },
  citations: [
    cite('Stamp Duty Land Tax: Residential property rates — Rates if you are not a UK resident', SDLT_URL),
  ],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ...SDLT_LIMITATIONS,
    'Non-residence for SDLT is tested on presence in the UK for fewer than 183 days in the 12 months before the transaction. The model takes the residency you select rather than testing day counts.',
    'The 2% surcharge can be refunded if the buyer later becomes UK resident under the statutory test. Refunds are not modelled.',
  ],
});

export const SDLT_NON_RESIDENTIAL = defineRule({
  id: 'gb-eaw.sdlt.nonresidential',
  name: 'SDLT — non-residential and mixed use',
  version: '2016-03-17',
  description: 'Freehold or lease-premium rates for commercial and mixed-use land. The additional-property and non-resident surcharges do not apply to non-residential property.',
  jurisdiction: { country: 'GB', region: 'GB-EAW' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2016-03-17',
  effectiveTo: null,
  currency: 'GBP',
  rounding: { scale: 0, mode: 'DOWN' },
  bands: [
    { from: '0', rate: '0', label: 'Up to £150,000' },
    { from: '150000', rate: '2', label: '£150,001 to £250,000' },
    { from: '250000', rate: '5', label: 'Above £250,000' },
  ],
  applicability: { propertyClass: [PROPERTY_CLASS.COMMERCIAL, PROPERTY_CLASS.MIXED, PROPERTY_CLASS.LAND] },
  citations: [cite('SDLT: Rates for non-residential and mixed land and property', SDLT_NONRES_URL)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'The separate net-present-value charge on non-residential lease rent is a distinct rule and is not included in this premium charge.',
  ],
});

export const SDLT_NONRES_LEASE_NPV = defineRule({
  id: 'gb-eaw.sdlt.nonresidential.lease-npv',
  component: COMPONENT.LEASE_NPV,
  name: 'SDLT — non-residential lease, net present value of rent',
  version: '2016-03-17',
  description: 'Charge on the net present value of rent payable over the life of a new non-residential lease, in addition to any charge on the premium.',
  jurisdiction: { country: 'GB', region: 'GB-EAW' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2016-03-17',
  effectiveTo: null,
  currency: 'GBP',
  rounding: { scale: 0, mode: 'DOWN' },
  bands: [
    { from: '0', rate: '0', label: '£0 to £150,000' },
    { from: '150000', rate: '1', label: '£150,001 to £5,000,000' },
    { from: '5000000', rate: '2', label: 'Above £5,000,000' },
  ],
  applicability: { propertyClass: [PROPERTY_CLASS.COMMERCIAL, PROPERTY_CLASS.MIXED] },
  citations: [cite('SDLT: Rates for non-residential and mixed land and property — net present value', SDLT_NONRES_URL)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: ['The net present value of the rent must be supplied; this rule does not discount a rent schedule for you.'],
});

/* ------------------------------------------------------------------ *
 * UK-wide income tax (England, Wales and Northern Ireland rates)
 * ------------------------------------------------------------------ */

/**
 * Non-savings, non-dividend income tax.
 *
 * Bands are stated on TAXABLE income — that is, after the Personal Allowance
 * has already been removed — because that is how the capital-gains band test
 * is expressed and mixing the two conventions is a reliable source of error.
 * The Personal Allowance and its taper are separate constants below.
 */
export const INCOME_TAX_EWNI = defineRule({
  id: 'gb.income-tax.ewni',
  name: 'UK Income Tax — England, Wales and Northern Ireland',
  version: '2026-27',
  description: 'Rates on non-savings, non-dividend income, applied to taxable income after the Personal Allowance.',
  jurisdiction: { country: 'GB', region: 'GB-EWNI' },
  category: CATEGORY.INCOME_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.OWNER,
  taxYear: TAX_YEAR,
  effectiveFrom: FROM,
  effectiveTo: '2027-04-05',
  currency: 'GBP',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '20', label: 'Basic rate' },
    { from: '37700', rate: '40', label: 'Higher rate' },
    { from: '112570', rate: '45', label: 'Additional rate' },
  ],
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL] },
  citations: [cite('Income Tax rates and Personal Allowances', INCOME_URL)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Scotland sets its own non-savings income tax rates and bands; this rule does not apply to Scottish taxpayers.',
    'Savings and dividend income use different rates and are outside this model.',
    'The additional-rate threshold is expressed here on taxable income (£125,140 gross less the £12,570 standard Personal Allowance). Where the allowance has been tapered away the gross threshold and the taxable threshold coincide at £125,140; the model applies the taper explicitly before using this table.',
  ],
});

/* ------------------------------------------------------------------ *
 * Capital gains tax
 * ------------------------------------------------------------------ */

/**
 * CGT on residential property gains.
 *
 * The rate depends on where the gain sits once STACKED on top of taxable
 * income — 18% while the total is inside the basic rate band, 24% above it.
 * This is why the engine evaluates it marginally rather than picking one rate:
 * a modest earner with a large gain pays across both.
 */
export const CGT_RESIDENTIAL = defineRule({
  id: 'gb.cgt.residential',
  name: 'UK Capital Gains Tax — property',
  version: '2026-27',
  description: 'Charged on the gain stacked above taxable income: 18% within the basic rate band, 24% above it.',
  jurisdiction: { country: 'GB' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.SELLER,
  taxYear: TAX_YEAR,
  effectiveFrom: FROM,
  effectiveTo: null,
  currency: 'GBP',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '18', label: 'Within the basic rate band' },
    { from: '37700', rate: '24', label: 'Above the basic rate band' },
  ],
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL] },
  citations: [cite('Capital Gains Tax: rates', CGT_URL)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Companies pay Corporation Tax on chargeable gains, not CGT. Company disposals are not covered by this rule.',
    'Private Residence Relief and lettings relief are not modelled — this product models investment property.',
    'A UK residential property disposal must be reported and the tax paid within 60 days of completion. The model reports the liability but does not produce the return.',
  ],
});

/* ------------------------------------------------------------------ *
 * Allowances and constants
 * ------------------------------------------------------------------ *
 * These are not rate tables, so they are not rules — but they carry the same
 * provenance metadata because they move every year and are just as capable of
 * being silently wrong.
 */

export const UK_CONSTANTS = Object.freeze({
  taxYear: TAX_YEAR,
  effectiveFrom: FROM,
  effectiveTo: '2027-04-05',
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,

  /** Standard Personal Allowance. */
  personalAllowance: '12570',
  /** Reduced by £1 for every £2 of adjusted net income above this figure. */
  personalAllowanceTaperFrom: '100000',
  personalAllowanceTaperRate: '0.5',
  /** Allowance is nil at or above this income. */
  personalAllowanceZeroAt: '125140',

  /** Width of the basic rate band, on taxable income. */
  basicRateBand: '37700',

  /** CGT annual exempt amount. */
  cgtAnnualExemptAmount: '3000',

  /** Property income allowance — the first £1,000 of rental income. */
  propertyAllowance: '1000',

  /**
   * Finance-cost restriction. Since April 2020 an individual landlord gets NO
   * deduction for mortgage interest against residential property income; they
   * get a basic-rate tax reducer instead, at 20% of the lower of finance
   * costs, property profits, and adjusted total income.
   *
   * This is the single most consequential UK-specific rule for a leveraged
   * buy-to-let investor and the previous model got it wrong in the taxpayer's
   * favour by deducting interest in full.
   */
  financeCostReliefRate: '20',

  citations: [
    cite('Income Tax rates and Personal Allowances', INCOME_URL),
    cite('Capital Gains Tax: rates', CGT_URL),
    cite('Tax relief for residential landlords: how it is worked out',
      'https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-worked-examples'),
  ],
});

/**
 * Devolved regimes we deliberately do not serve from the English tables.
 *
 * The registry turns each of these into an explicit "unsupported" result. A
 * refusal is a correct answer; an English SDLT figure for a Scottish purchase
 * is not.
 */
export const UNSUPPORTED_REGIONS = Object.freeze([
  {
    region: 'GB-SCT',
    name: 'Scotland',
    reason: 'Scotland charges Land and Buildings Transaction Tax (LBTT) with its own bands and Additional Dwelling Supplement, administered by Revenue Scotland, and sets its own non-savings income tax rates. Neither is modelled yet.',
    authority: 'Revenue Scotland',
    url: 'https://revenue.scot/taxes/land-buildings-transaction-tax',
  },
  {
    region: 'GB-WLS',
    name: 'Wales',
    reason: 'Wales charges Land Transaction Tax (LTT) with its own bands and higher-rates surcharge, administered by the Welsh Revenue Authority. It is not modelled yet. Welsh income tax rates currently match those of England and Northern Ireland.',
    authority: 'Welsh Revenue Authority',
    url: 'https://www.gov.wales/land-transaction-tax-guide',
  },
]);

export const UK_RULES = Object.freeze([
  SDLT_RESIDENTIAL_STANDARD,
  SDLT_RESIDENTIAL_ADDITIONAL,
  SDLT_RESIDENTIAL_ADDITIONAL_NONRESIDENT,
  SDLT_NON_RESIDENTIAL,
  SDLT_NONRES_LEASE_NPV,
  INCOME_TAX_EWNI,
  CGT_RESIDENTIAL,
]);
