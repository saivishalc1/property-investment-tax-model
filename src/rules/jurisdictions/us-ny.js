/**
 * us-ny.js — United States federal and New York rule pack.
 *
 * FOUR LEVELS OF GOVERNMENT tax the same New York City transaction, and they
 * disagree about who pays, how the rate is computed, and what counts as
 * residential. Keeping them as separate rules with separate payers is the only
 * way a closing statement comes out right:
 *
 *   Federal   capital gain, unrecaptured section 1250 gain, net investment
 *             income tax
 *   State     real estate transfer tax (seller), mansion tax (buyer)
 *   City      real property transfer tax (seller), additional base tax (seller)
 *
 * THREE THINGS THAT ARE EASY TO GET WRONG AND ARE TESTED HERE.
 *
 * 1. The state base tax is "two dollars for each $500, or FRACTIONAL PART
 *    thereof". That is not 0.4%. A $295,100 sale is charged on 591 whole units,
 *    not 590.2, so the tax is $1,182 rather than $1,180.40. Every consideration
 *    that is not an exact multiple of $500 is understated by treating it as a
 *    percentage.
 *
 * 2. The mansion tax and the city transfer tax are CLIFF charges on the whole
 *    consideration. One dollar over $1,000,000 adds $10,000 of mansion tax on a
 *    residence; one dollar over $500,000 moves a city transfer tax from 1% to
 *    1.425% of everything. These are re-rating thresholds, not marginal bands,
 *    and confusing the two is the most expensive mistake in the file.
 *
 * 3. Unrecaptured section 1250 gain is taxed at a MAXIMUM of 25%, not a flat
 *    25%. It is ordinary-rate income subject to a ceiling, so a taxpayer whose
 *    marginal rate is below 25% pays the lower figure. The IRS wording is
 *    "taxed at a maximum 25% rate" and the engine applies it as the cap it is.
 *
 * SOURCES: IRS, New York State Department of Taxation and Finance, and the
 * New York City Department of Finance, read directly 2026-08-23.
 */

import {
  defineRule, METHOD, CATEGORY, PAYER, PROPERTY_CLASS, OWNERSHIP, COMPONENT,
} from '../schema.js';
import { STATUS } from '../../core/trace.js';

const ACCESSED = '2026-08-23';
const REVIEWED = '2026-08-23';

const irs = (title, url, primary = true) => ({
  title, publisher: 'Internal Revenue Service', url, accessed: ACCESSED, primary,
});
const nys = (title, url, primary = true) => ({
  title, publisher: 'New York State Department of Taxation and Finance', url, accessed: ACCESSED, primary,
});
const nyc = (title, url, primary = true) => ({
  title, publisher: 'New York City Department of Finance', url, accessed: ACCESSED, primary,
});

const URL_409 = 'https://www.irs.gov/taxtopics/tc409';
const URL_RETT = 'https://www.tax.ny.gov/bus/transfer/rptidx.htm';
const URL_RPTT = 'https://www.nyc.gov/site/finance/property/property-real-property-transfer-tax-rptt.page';

/* ------------------------------------------------------------------ *
 * Federal — capital gains
 * ------------------------------------------------------------------ */

/**
 * Long-term capital gains, tax year 2025.
 *
 * DATED DELIBERATELY. IRS Topic 409 published the 2025 thresholds at the time
 * of reading, and the 2026 figures were not yet on that page. Rather than
 * carry the 2025 numbers forward under a 2026 label — which is what the
 * previous taxTables.js did, marking them "provisional" but still using them —
 * this rule ENDS on 2025-12-31. A 2026 disposal therefore resolves to nothing
 * and the engine reports the gap, until the 2026 schedule is entered.
 */
export const FEDERAL_LTCG_2025 = defineRule({
  id: 'us.federal.ltcg.single.2025',
  name: 'Federal long-term capital gains — single filer',
  version: '2025',
  description: 'Net capital gain taxed at 0%, 15% or 20% by total taxable income, with the gain stacked on top of ordinary income.',
  jurisdiction: { country: 'US' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '2025-01-01',
  effectiveTo: '2025-12-31',
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '0', label: '0% band' },
    { from: '48350', rate: '15', label: '15% band' },
    { from: '533400', rate: '20', label: '20% band' },
  ],
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], filingStatus: ['single'] },
  citations: [irs('Topic no. 409, Capital gains and losses', URL_409)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Tax year 2025 thresholds. The 2026 figures were not published on Topic 409 at the access date, so this rule expires on 2025-12-31 rather than being carried forward under a 2026 label.',
    'Collectibles (28% maximum) and qualified small business stock (28% maximum) are outside this rule.',
    'Short-term gains — assets held one year or less — are taxed as ordinary income and are not covered here.',
  ],
});

export const FEDERAL_LTCG_MFJ_2025 = defineRule({
  id: 'us.federal.ltcg.mfj.2025',
  name: 'Federal long-term capital gains — married filing jointly',
  version: '2025',
  jurisdiction: { country: 'US' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '2025-01-01',
  effectiveTo: '2025-12-31',
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '0', label: '0% band' },
    { from: '96700', rate: '15', label: '15% band' },
    { from: '600050', rate: '20', label: '20% band' },
  ],
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], filingStatus: ['mfj'] },
  citations: [irs('Topic no. 409, Capital gains and losses', URL_409)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: ['Tax year 2025 thresholds; expires 2025-12-31 rather than being carried into 2026 unverified.'],
});

/**
 * Unrecaptured section 1250 gain — the CEILING, not a rate.
 *
 * The IRS wording is that this portion of the gain "is taxed at a maximum 25%
 * rate". It is ordinary-rate income with a cap: an investor whose marginal
 * rate is 22% pays 22%, not 25%. Applying a flat 25% overstates the bill for
 * every taxpayer below the cap, which is most of the ones this product is for.
 *
 * The engine must compute the ordinary-rate charge and then apply this as a
 * maximum, which is why the rule is expressed as a rate WITH a cap semantic
 * rather than as the charge itself.
 */
export const FEDERAL_1250_CAP = defineRule({
  id: 'us.federal.unrecaptured-1250.cap',
  name: 'Unrecaptured section 1250 gain — 25% maximum',
  version: '2025',
  description: 'The portion of gain attributable to depreciation is taxed at ordinary rates, subject to a maximum of 25%.',
  jurisdiction: { country: 'US' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  component: COMPONENT.SURTAX,
  method: METHOD.FLAT_RATE,
  rate: '25',
  rateLabel: 'Unrecaptured section 1250 gain, 25% ceiling',
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '1997-05-07',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL] },
  citations: [irs('Topic no. 409 — unrecaptured section 1250 gain is taxed at a maximum 25% rate', URL_409)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'This is a CEILING on an ordinary-rate charge, not a flat rate. The engine must compute the ordinary-rate figure and take the lower of the two.',
    'The unrecaptured amount is capped at accumulated depreciation and is taken out of the gain before the residual is treated as long-term capital gain.',
  ],
});

/**
 * Net Investment Income Tax. The thresholds are NOT indexed for inflation,
 * which is why they are constants rather than a table that needs an annual
 * review — they have not moved since 2013 and will not move without Congress.
 */
export const NIIT = defineRule({
  id: 'us.federal.niit',
  name: 'Net Investment Income Tax (section 1411)',
  version: '2013',
  description: '3.8% of the lesser of net investment income and the excess of modified adjusted gross income over the filing-status threshold.',
  jurisdiction: { country: 'US' },
  category: CATEGORY.SURTAX,
  method: METHOD.FLAT_RATE,
  rate: '3.8',
  rateLabel: 'NIIT 3.8%',
  payer: PAYER.OWNER,
  taxYear: '2025',
  effectiveFrom: '2013-01-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL] },
  citations: [irs('Topic no. 559, Net investment income tax', 'https://www.irs.gov/taxtopics/tc559')],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'The base is the LESSER of net investment income and the MAGI excess over the threshold. Applying the rate to the whole gain overstates it for anyone near the threshold.',
    'Thresholds are not indexed for inflation: $200,000 single, $250,000 married filing jointly, $125,000 married filing separately.',
  ],
});

export const NIIT_THRESHOLDS = Object.freeze({
  single: '200000', mfj: '250000', mfs: '125000', hoh: '200000',
  citation: irs('Topic no. 559, Net investment income tax', 'https://www.irs.gov/taxtopics/tc559'),
  verification: STATUS.VERIFIED,
});

/* ------------------------------------------------------------------ *
 * New York State
 * ------------------------------------------------------------------ */

export const NYS_TRANSFER_TAX = defineRule({
  id: 'us-ny.transfer-tax.base',
  name: 'NYS real estate transfer tax — base',
  version: '2019-07-01',
  description: 'Two dollars for each $500 of consideration, or fractional part thereof. Payable by the grantor (seller).',
  jurisdiction: { country: 'US', region: 'US-NY' },
  category: CATEGORY.TRANSFER_TAX,
  method: METHOD.PER_UNIT_STEP,
  unitSize: '500',
  amountPerUnit: '2',
  rateLabel: '$2 per $500 or fractional part',
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '1968-08-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  // The tax applies only where consideration exceeds $500.
  exemptBelow: '500.01',
  citations: [nys('Real estate transfer tax', URL_RETT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Paid by the grantor. If the grantor does not pay or is exempt, the grantee must. Where a residential grantee pays it under contract, that amount is excluded from the consideration subject to tax — a circularity this rule does not resolve for you.',
    'Conveyances to or from a limited liability company, and the statutory exemptions, are not modelled.',
  ],
});

export const NYS_MANSION_TAX = defineRule({
  id: 'us-ny.mansion-tax',
  name: 'NYS mansion tax',
  version: '1989-07-01',
  description: 'An additional 1% of the whole sale price on a residence where the consideration is $1,000,000 or more. Payable by the buyer.',
  jurisdiction: { country: 'US', region: 'US-NY' },
  category: CATEGORY.TRANSFER_TAX,
  component: COMPONENT.SURTAX,
  // A CLIFF: one dollar over the threshold re-rates the entire price.
  method: METHOD.CLIFF_WHOLE_VALUE,
  payer: PAYER.BUYER,
  taxYear: '2025',
  effectiveFrom: '1989-07-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '0', label: 'Below $1,000,000 — no mansion tax' },
    { from: '1000000', rate: '1', label: '$1,000,000 or more — 1% of the entire price' },
  ],
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL] },
  citations: [nys('Real estate transfer tax — additional tax (mansion tax)', URL_RETT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Applies to residences only. Commercial conveyances do not attract it.',
    'Paid by the buyer; if the buyer does not pay or is exempt, the seller must.',
    'For New York City residences of $2,000,000 or more an additional supplemental tax applies on a schedule this pack does not yet carry — see the declared gap in the registry.',
  ],
});

export const NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL = defineRule({
  id: 'us-ny.transfer-tax.additional-base.nyc-residential',
  name: 'NYS additional base tax — NYC residential $3m+',
  version: '2019-07-01',
  description: '$1.25 for each $500, or fractional part, on a New York City residential conveyance of $3,000,000 or more.',
  jurisdiction: { country: 'US', region: 'US-NY', locality: 'NYC' },
  category: CATEGORY.TRANSFER_TAX,
  component: COMPONENT.NATIONAL,
  method: METHOD.PER_UNIT_STEP,
  unitSize: '500',
  amountPerUnit: '1.25',
  rateLabel: '$1.25 per $500 or fractional part',
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '2019-07-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  exemptBelow: '3000000',
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL] },
  citations: [nys('Real estate transfer tax — additional base tax', URL_RETT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Does not apply to conveyances made pursuant to a binding written contract entered into on or before 1 April 2019.',
  ],
});

/* ------------------------------------------------------------------ *
 * New York City
 * ------------------------------------------------------------------ */

export const NYC_RPTT_RESIDENTIAL = defineRule({
  id: 'us-ny.nyc.rptt.residential',
  name: 'NYC Real Property Transfer Tax — residential',
  version: '2025',
  description: '1% of the whole price up to $500,000; 1.425% of the whole price above it. A one-to-three family house, an individual co-op apartment or an individual condominium unit.',
  jurisdiction: { country: 'US', region: 'US-NY', locality: 'NYC' },
  category: CATEGORY.TRANSFER_TAX,
  method: METHOD.CLIFF_WHOLE_VALUE,
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '1989-08-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '1', label: '$500,000 or less — 1%' },
    { from: '500000.01', rate: '1.425', label: 'More than $500,000 — 1.425%' },
  ],
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL] },
  citations: [nyc('Real Property Transfer Tax (RPTT)', URL_RPTT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'A cliff at $500,000: the higher rate applies to the ENTIRE price, not to the excess.',
    'A four-or-more family dwelling is taxed under the commercial schedule, not this one.',
    'Transfers of at least 50% of an entity owning New York City property are also taxable and are not modelled.',
  ],
});

export const NYC_RPTT_COMMERCIAL = defineRule({
  id: 'us-ny.nyc.rptt.commercial',
  name: 'NYC Real Property Transfer Tax — commercial and other',
  version: '2025',
  description: '1.425% of the whole price up to $500,000; 2.625% of the whole price above it. Commercial property, four-or-more family dwellings and vacant land.',
  jurisdiction: { country: 'US', region: 'US-NY', locality: 'NYC' },
  category: CATEGORY.TRANSFER_TAX,
  method: METHOD.CLIFF_WHOLE_VALUE,
  payer: PAYER.SELLER,
  taxYear: '2025',
  effectiveFrom: '1989-08-01',
  effectiveTo: null,
  currency: 'USD',
  rounding: { scale: 2, mode: 'HALF_UP' },
  bands: [
    { from: '0', rate: '1.425', label: '$500,000 or less — 1.425%' },
    { from: '500000.01', rate: '2.625', label: 'More than $500,000 — 2.625%' },
  ],
  applicability: { propertyClass: [PROPERTY_CLASS.COMMERCIAL, PROPERTY_CLASS.LAND] },
  citations: [nyc('Real Property Transfer Tax (RPTT)', URL_RPTT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'A cliff at $500,000: the higher rate applies to the ENTIRE price.',
  ],
});

/**
 * Gaps we know about and refuse to guess at.
 *
 * The New York City supplemental tax is real, is charged on residences of
 * $2,000,000 or more, and runs on an incremental schedule between 0.25% and
 * 2.9% — the Department confirms that range in prose. What it does not publish
 * on that page is the band table, and the schedule is the whole rule. Encoding
 * plausible bands from memory would produce numbers that look authoritative
 * and are unverifiable, which is exactly what this product exists not to do.
 */
export const US_NY_DECLARED_GAPS = Object.freeze([
  {
    country: 'US',
    region: 'US-NY',
    category: CATEGORY.SURCHARGE,
    reason: 'The New York City supplemental transfer tax on residences of $2,000,000 or more runs on an incremental schedule between 0.25% and 2.9%. The band table was not obtained from a primary source, so the charge is not computed rather than estimated. A New York City residential purchase at or above $2,000,000 will therefore understate the total transfer tax until the schedule is entered.',
    authority: 'New York State Department of Taxation and Finance',
    url: URL_RETT,
  },
]);

export const US_NY_RULES = Object.freeze([
  FEDERAL_LTCG_2025, FEDERAL_LTCG_MFJ_2025, FEDERAL_1250_CAP, NIIT,
  NYS_TRANSFER_TAX, NYS_MANSION_TAX, NYS_ADDITIONAL_BASE_NYC_RESIDENTIAL,
  NYC_RPTT_RESIDENTIAL, NYC_RPTT_COMMERCIAL,
]);
