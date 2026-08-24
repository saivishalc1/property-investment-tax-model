/**
 * jp.js — Japan rule pack.
 *
 * SCOPE. Japan taxes property at three levels and this pack keeps them
 * distinct, because a Japanese investor sees them as separate bills:
 *
 *   National (国税)        income tax, capital gains, reconstruction surtax,
 *                          registration and licence tax, stamp tax, consumption tax
 *   Prefectural (都道府県税) real estate acquisition tax
 *   Municipal (市町村税)    fixed asset tax, city planning tax, inhabitant tax
 *
 * TWO THINGS THE PREVIOUS MODEL GOT STRUCTURALLY WRONG, both fixed here.
 *
 * 1. The five-year line is not measured from the purchase date. Under 措法31
 *    and 措法32 the test is whether the holding period exceeded five years
 *    AS OF 1 JANUARY OF THE YEAR OF SALE (譲渡した年の1月1日現在の所有期間).
 *    A property bought in June 2020 and sold in July 2025 has been held more
 *    than five calendar years, but on 1 January 2025 it had been held four and
 *    a half — so it is SHORT term, at 39.63% rather than 20.315%. That is a
 *    19-point difference driven by a rule the naive reading gets backwards.
 *    See jpHoldingPeriodIsLongTerm() below.
 *
 * 2. Several of these taxes are charged on 固定資産税評価額 — the assessed
 *    value on the fixed asset tax roll — NOT on the purchase price. Assessed
 *    value is materially lower than market. Feeding the purchase price into
 *    them overstates the bill, so the engine requires the assessed value as an
 *    input and marks the result as an assumption if it is estimated from price.
 *
 * SOURCES: National Tax Agency (国税庁) and the Tokyo Metropolitan Government
 * Bureau of Taxation (東京都主税局), read directly 2026-08-23. URLs on each rule.
 */

import { defineRule, METHOD, CATEGORY, PAYER, PROPERTY_CLASS, OWNERSHIP, COMPONENT, HOLDING_PERIOD } from '../schema.js';
import { STATUS } from '../../core/trace.js';

const ACCESSED = '2026-08-23';
const REVIEWED = '2026-08-23';
const TAX_YEAR = '2026';

const nta = (title, url, primary = true) => ({
  title, publisher: '国税庁 (National Tax Agency)', url, accessed: ACCESSED, primary,
});
const tokyo = (title, url, primary = true) => ({
  title, publisher: '東京都主税局 (Tokyo Metropolitan Government Bureau of Taxation)',
  url, accessed: ACCESSED, primary,
});

const URL_LONG = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm';
const URL_SHORT = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm';
const URL_INCOME = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm';
const URL_REG = 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7191.htm';
const URL_ACQ = 'https://www.tax.metro.tokyo.lg.jp/shisan/fudosan.html';
const URL_LIFE = 'https://www.keisan.nta.go.jp/r5yokuaru/aoiroshinkoku/hitsuyokeihi/genkashokyakuhi/taiyonensutatemono.html';

/* ------------------------------------------------------------------ *
 * The five-year test (措法31 / 措法32)
 * ------------------------------------------------------------------ */

/**
 * Is the disposal long-term under Japanese law?
 *
 * The statute compares the acquisition date with 1 January of the year of
 * sale, not with the sale date. Long term requires the holding period at that
 * reference point to EXCEED five years; exactly five years or less is short
 * term (5年以下).
 *
 * @param {string} acquisitionDate ISO date, e.g. '2020-06-15'
 * @param {string} disposalDate    ISO date, e.g. '2025-07-01'
 * @returns {{ longTerm: boolean, referenceDate: string, yearsAtReference: number,
 *             explanation: string }}
 */
export function jpHoldingPeriodIsLongTerm(acquisitionDate, disposalDate) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(acquisitionDate) || !iso.test(disposalDate)) {
    throw new RangeError('jpHoldingPeriodIsLongTerm: dates must be ISO YYYY-MM-DD');
  }
  if (disposalDate < acquisitionDate) {
    throw new RangeError('jpHoldingPeriodIsLongTerm: disposal precedes acquisition');
  }

  const saleYear = Number(disposalDate.slice(0, 4));
  const referenceDate = `${saleYear}-01-01`;

  // Whole years elapsed from acquisition to 1 January of the year of sale.
  const [ay, am, ad] = acquisitionDate.split('-').map(Number);
  let years = saleYear - ay;
  // 1 January is before any acquisition month/day later than 1 January.
  if (am > 1 || (am === 1 && ad > 1)) years -= 1;

  const longTerm = years > 5;
  return {
    longTerm,
    referenceDate,
    yearsAtReference: years,
    explanation: longTerm
      ? `Held ${years} full years as at ${referenceDate} (1 January of the year of sale), which exceeds five, so the disposal is long term (長期譲渡所得, 措法31).`
      : `Held ${years} full years as at ${referenceDate} (1 January of the year of sale), which does not exceed five, so the disposal is short term (短期譲渡所得, 措法32) even if more than five calendar years have passed since purchase.`,
  };
}

/* ------------------------------------------------------------------ *
 * Capital gains — national, local and surtax
 * ------------------------------------------------------------------ */

const CGT_LIMITATIONS = [
  'The 3,000万円 special deduction for a disposal of one\'s own residence (措法35) is not modelled — this product models investment property.',
  'Replacement and exchange reliefs (措法36の2, 措法37) are not modelled.',
  'Where the actual acquisition cost is unknown, 5% of the sale price may be used as a deemed cost (概算取得費). The model uses the cost you supply and does not apply this substitution automatically.',
];

export const CGT_LONG_NATIONAL = defineRule({
  id: 'jp.cgt.long.national',
  name: '長期譲渡所得 — national income tax',
  version: '2025-04-01',
  description: 'National income tax at 15% on a long-term real property gain: holding period exceeding five years as at 1 January of the year of sale.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.FLAT_RATE,
  rate: '15',
  rateLabel: '所得税 15%',
  payer: PAYER.SELLER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2004-01-01',
  effectiveTo: null,
  currency: 'JPY',
  // 課税譲渡所得金額 is taken to the whole 1,000 yen below.
  rounding: { scale: 0, mode: 'DOWN', baseFloorToUnit: '1000' },
  component: COMPONENT.NATIONAL,
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], holdingPeriod: [HOLDING_PERIOD.LONG] },
  citations: [nta('No.3208 長期譲渡所得の税額の計算', URL_LONG)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: CGT_LIMITATIONS,
  notes: '措法31',
});

export const CGT_LONG_LOCAL = defineRule({
  id: 'jp.cgt.long.local',
  name: '長期譲渡所得 — local inhabitant tax',
  version: '2025-04-01',
  description: 'Local inhabitant tax (住民税) at 5% on a long-term real property gain.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.FLAT_RATE,
  rate: '5',
  rateLabel: '住民税 5%',
  payer: PAYER.SELLER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2004-01-01',
  effectiveTo: null,
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN', baseFloorToUnit: '1000' },
  component: COMPONENT.LOCAL,
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], holdingPeriod: [HOLDING_PERIOD.LONG] },
  citations: [nta('No.3208 長期譲渡所得の税額の計算', URL_LONG)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ...CGT_LIMITATIONS,
    'Inhabitant tax on a gain is assessed in the year following the disposal and is not payable at completion.',
  ],
});

export const CGT_SHORT_NATIONAL = defineRule({
  id: 'jp.cgt.short.national',
  name: '短期譲渡所得 — national income tax',
  version: '2025-04-01',
  description: 'National income tax at 30% on a short-term real property gain: holding period of five years or less as at 1 January of the year of sale.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.FLAT_RATE,
  rate: '30',
  rateLabel: '所得税 30%',
  payer: PAYER.SELLER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2004-01-01',
  effectiveTo: null,
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN', baseFloorToUnit: '1000' },
  component: COMPONENT.NATIONAL,
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], holdingPeriod: [HOLDING_PERIOD.SHORT] },
  citations: [nta('No.3211 短期譲渡所得の税額の計算', URL_SHORT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: CGT_LIMITATIONS,
  notes: '措法32',
});

export const CGT_SHORT_LOCAL = defineRule({
  id: 'jp.cgt.short.local',
  name: '短期譲渡所得 — local inhabitant tax',
  version: '2025-04-01',
  description: 'Local inhabitant tax (住民税) at 9% on a short-term real property gain.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.CAPITAL_GAINS_TAX,
  method: METHOD.FLAT_RATE,
  rate: '9',
  rateLabel: '住民税 9%',
  payer: PAYER.SELLER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2004-01-01',
  effectiveTo: null,
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN', baseFloorToUnit: '1000' },
  component: COMPONENT.LOCAL,
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL], holdingPeriod: [HOLDING_PERIOD.SHORT] },
  citations: [nta('No.3211 短期譲渡所得の税額の計算', URL_SHORT)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: CGT_LIMITATIONS,
});

/**
 * 復興特別所得税 — special income tax for reconstruction.
 *
 * 2.1% of the BASE INCOME TAX AMOUNT, not 2.1% of the gain. Applying it to the
 * gain would overstate it roughly sevenfold on a long-term disposal. In force
 * for 平成25年 to 令和19年 (2013 to 2037).
 */
export const RECONSTRUCTION_SURTAX = defineRule({
  id: 'jp.surtax.reconstruction',
  name: '復興特別所得税 — reconstruction surtax',
  version: '2013-01-01',
  description: 'Levied at 2.1% of the national income tax amount (not of income), payable alongside it. In force from 2013 to 2037.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.SURTAX,
  method: METHOD.FLAT_RATE,
  rate: '2.1',
  rateLabel: '復興特別所得税 2.1%',
  payer: PAYER.OWNER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2013-01-01',
  effectiveTo: '2037-12-31',
  currency: 'JPY',
  component: COMPONENT.SURTAX,
  rounding: { scale: 0, mode: 'DOWN' },
  citations: [nta('No.3208 長期譲渡所得の税額の計算 (注1)', URL_LONG)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: ['Applies to the national income tax component only. Local inhabitant tax carries no reconstruction surtax.'],
  notes: '復興財確法13',
});

/* ------------------------------------------------------------------ *
 * Income tax on rental income
 * ------------------------------------------------------------------ */

export const INCOME_TAX = defineRule({
  id: 'jp.income-tax.national',
  name: '所得税 — national income tax',
  version: '2026',
  description: 'Progressive national income tax, seven bands from 5% to 45%, applied to taxable income taken down to the whole 1,000 yen.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.INCOME_TAX,
  method: METHOD.PROGRESSIVE_SLICE,
  payer: PAYER.OWNER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2015-01-01',
  effectiveTo: null,
  currency: 'JPY',
  // 課税される所得金額（1,000円未満の端数金額を切り捨てた後の金額）
  rounding: { scale: 0, mode: 'DOWN', baseFloorToUnit: '1000' },
  bands: [
    { from: '0', rate: '5', label: '～1,949,000円' },
    { from: '1950000', rate: '10', label: '1,950,000～3,299,000円' },
    { from: '3300000', rate: '20', label: '3,300,000～6,949,000円' },
    { from: '6950000', rate: '23', label: '6,950,000～8,999,000円' },
    { from: '9000000', rate: '33', label: '9,000,000～17,999,000円' },
    { from: '18000000', rate: '40', label: '18,000,000～39,999,000円' },
    { from: '40000000', rate: '45', label: '40,000,000円～' },
  ],
  applicability: { ownership: [OWNERSHIP.INDIVIDUAL] },
  citations: [nta('No.2260 所得税の税率', URL_INCOME)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    'Deductions and allowances (基礎控除, 青色申告特別控除 and others) are not applied by this rule; supply taxable income after deductions.',
    'Local inhabitant tax on income is charged separately, broadly at a flat 10%.',
    'Rental income of a non-resident is subject to withholding and different filing rules; see the withholding rule.',
  ],
});

/* ------------------------------------------------------------------ *
 * Acquisition-stage taxes
 * ------------------------------------------------------------------ */

const ASSESSED_VALUE_LIMITATION =
  'Charged on 固定資産税評価額 (the fixed asset tax assessed value), not on the purchase price. Assessed value is materially below market value, so supplying the price here overstates the charge.';

export const ACQUISITION_TAX_LAND = defineRule({
  id: 'jp.acquisition-tax.land',
  name: '不動産取得税 — land',
  version: '2008-04-01',
  description: 'Prefectural real estate acquisition tax on land at 3%. For residential land acquired up to 31 March 2027 the taxable base is halved.',
  jurisdiction: { country: 'JP', region: 'JP-13' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.FLAT_RATE,
  rate: '3',
  rateLabel: '不動産取得税 3%',
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2008-04-01',
  effectiveTo: '2027-03-31',
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN' },
  // 免税点: no charge where the assessed value is below 100,000 yen.
  exemptBelow: '100000',
  applicability: { propertyClass: [PROPERTY_CLASS.LAND] },
  citations: [tokyo('不動産取得税', URL_ACQ)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ASSESSED_VALUE_LIMITATION,
    'Rates and reliefs are set by each prefecture. These are the Tokyo Metropolitan figures; another prefecture may differ and must be selected explicitly.',
    'The halving of the base for 宅地等 up to 31 March 2027 must be applied to the base before this rule is evaluated.',
  ],
});

export const ACQUISITION_TAX_BUILDING_RESIDENTIAL = defineRule({
  id: 'jp.acquisition-tax.building.residential',
  name: '不動産取得税 — residential building',
  version: '2008-04-01',
  description: 'Prefectural real estate acquisition tax on a residential building at 3%.',
  jurisdiction: { country: 'JP', region: 'JP-13' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.FLAT_RATE,
  rate: '3',
  rateLabel: '不動産取得税（住宅）3%',
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2008-04-01',
  effectiveTo: '2027-03-31',
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN' },
  exemptBelow: '120000',
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL] },
  citations: [tokyo('不動産取得税', URL_ACQ)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ASSESSED_VALUE_LIMITATION,
    'The 免税点 differs by how the building was acquired: 230,000 yen for new build, extension or reconstruction, and 120,000 yen otherwise. This rule uses the acquisition-by-purchase figure.',
    'Reliefs for new and second-hand homes occupied by the buyer are not modelled — this product models investment property.',
  ],
});

export const ACQUISITION_TAX_BUILDING_NONRESIDENTIAL = defineRule({
  id: 'jp.acquisition-tax.building.nonresidential',
  name: '不動産取得税 — non-residential building',
  version: '2008-04-01',
  description: 'Prefectural real estate acquisition tax on a non-residential building at 4%. The reduced 3% rate applies to land and to residential buildings only.',
  jurisdiction: { country: 'JP', region: 'JP-13' },
  category: CATEGORY.ACQUISITION_TAX,
  method: METHOD.FLAT_RATE,
  rate: '4',
  rateLabel: '不動産取得税（非住宅）4%',
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2008-04-01',
  effectiveTo: null,
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN' },
  exemptBelow: '120000',
  applicability: { propertyClass: [PROPERTY_CLASS.COMMERCIAL] },
  citations: [tokyo('不動産取得税', URL_ACQ)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [ASSESSED_VALUE_LIMITATION],
});

export const REGISTRATION_TAX_LAND_SALE = defineRule({
  id: 'jp.registration-tax.land.sale',
  name: '登録免許税 — land, transfer by sale',
  version: '2026',
  description: 'National registration and licence tax on registering a transfer of land by sale. The statutory rate is 2%, reduced to 1.5% for registrations received up to 31 March 2029.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.REGISTRATION_TAX,
  method: METHOD.FLAT_RATE,
  rate: '1.5',
  rateLabel: '登録免許税（土地・売買）1.5%',
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2026-04-01',
  effectiveTo: '2029-03-31',
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN', floorToUnit: '100' },
  applicability: { propertyClass: [PROPERTY_CLASS.LAND] },
  citations: [nta('No.7191 登録免許税の税額表', URL_REG)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ASSESSED_VALUE_LIMITATION,
    'Reverts to the statutory 2% for registrations received after 31 March 2029 (措法72).',
  ],
});

export const REGISTRATION_TAX_BUILDING_SALE = defineRule({
  id: 'jp.registration-tax.building.sale',
  name: '登録免許税 — building, transfer by sale',
  version: '2026',
  description: 'National registration and licence tax at 2% on registering a transfer of a building by sale or auction.',
  jurisdiction: { country: 'JP' },
  category: CATEGORY.REGISTRATION_TAX,
  method: METHOD.FLAT_RATE,
  rate: '2',
  rateLabel: '登録免許税（建物・売買）2%',
  payer: PAYER.BUYER,
  taxYear: TAX_YEAR,
  effectiveFrom: '2003-04-01',
  effectiveTo: null,
  currency: 'JPY',
  rounding: { scale: 0, mode: 'DOWN', floorToUnit: '100' },
  applicability: { propertyClass: [PROPERTY_CLASS.RESIDENTIAL, PROPERTY_CLASS.COMMERCIAL] },
  citations: [nta('No.7191 登録免許税の税額表', URL_REG)],
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
  limitations: [
    ASSESSED_VALUE_LIMITATION,
    'Reduced rates for an individual acquiring a home for their own occupation (措法73) are not applied — this product models investment property.',
  ],
});

/* ------------------------------------------------------------------ *
 * Depreciation — 耐用年数省令 別表第一
 * ------------------------------------------------------------------ */

/**
 * Statutory useful lives for buildings, in years, by structure and by use.
 *
 * This is the table the previous model flattened to "47 for everything", which
 * is right only for reinforced concrete used residentially. A wooden apartment
 * block depreciates over 22 years — less than half — and gets a materially
 * different annual deduction.
 */
export const USEFUL_LIVES = Object.freeze({
  reinforcedConcrete: { label: '鉄骨鉄筋コンクリート造・鉄筋コンクリート造', office: 50, residential: 47, shop: 39, hotel: 39, hospital: 39, garage: 38, bathhouse: 31, warehouse: 38 },
  brickStoneBlock: { label: 'れんが造・石造・ブロック造', office: 41, residential: 38, shop: 38, restaurant: 38, hotel: 36, hospital: 36, garage: 34, bathhouse: 30, warehouse: 34 },
  steelOver4mm: { label: '金属造（骨格材肉厚4mm超）', office: 38, residential: 34, shop: 34, restaurant: 31, garage: 31, hotel: 29, hospital: 29, bathhouse: 27, warehouse: 31 },
  steel3to4mm: { label: '金属造（骨格材肉厚3mm超4mm以下）', office: 30, residential: 27, shop: 27, restaurant: 25, garage: 25, hotel: 24, hospital: 24, bathhouse: 19, warehouse: 24 },
  steelUnder3mm: { label: '金属造（骨格材肉厚3mm以下）', office: 22, residential: 19, shop: 19, restaurant: 19, garage: 19, hotel: 17, hospital: 17, bathhouse: 15, warehouse: 17 },
  wood: { label: '木造・合成樹脂造', office: 24, residential: 22, shop: 22, restaurant: 20, hotel: 17, hospital: 17, garage: 17, bathhouse: 12, warehouse: 15 },
  woodMortar: { label: '木骨モルタル造', office: 22, residential: 20, shop: 20, restaurant: 19, hotel: 15, hospital: 15, garage: 15, bathhouse: 11, warehouse: 14 },

  citation: nta('主な減価償却資産の耐用年数表（建物・建物附属設備）', URL_LIFE),
  lastReviewed: REVIEWED,
  verification: STATUS.VERIFIED,
});

/**
 * Useful life of a SECOND-HAND building (中古資産の耐用年数, 耐用年数省令3条).
 *
 * Almost every investment purchase in Japan is second-hand, and the remaining
 * life is not simply "statutory life minus age":
 *
 *   Statutory life fully elapsed   -> statutory life x 20%
 *   Partly elapsed                 -> (statutory - elapsed) + elapsed x 20%
 *
 * The result is truncated to whole years with a floor of two years. A 30-year-old
 * wooden house (statutory 22, fully elapsed) therefore depreciates over 4 years,
 * not 0 and not 22 — which changes the deduction profile enormously.
 *
 * @param {number} statutoryLife years from USEFUL_LIVES
 * @param {number} elapsedYears  age of the building at acquisition
 */
export function usedBuildingUsefulLife(statutoryLife, elapsedYears) {
  if (!(statutoryLife > 0)) throw new RangeError('usedBuildingUsefulLife: statutoryLife must be positive');
  if (!(elapsedYears >= 0)) throw new RangeError('usedBuildingUsefulLife: elapsedYears must be zero or more');

  const raw = elapsedYears >= statutoryLife
    ? statutoryLife * 0.2
    : (statutoryLife - elapsedYears) + elapsedYears * 0.2;

  return Math.max(2, Math.trunc(raw));
}

export const JP_CONSTANTS = Object.freeze({
  taxYear: TAX_YEAR,
  lastReviewed: REVIEWED,

  /** Combined effective rates, for cross-checking against published figures. */
  longTermCombinedRate: '20.315',
  shortTermCombinedRate: '39.63',

  /** Withholding on a disposal by a non-resident. */
  nonResidentDisposalWithholding: '10.21',

  /** Consumption tax. Charged on buildings; land is exempt. */
  consumptionTaxRate: '10',

  /** Standard municipal rates. Municipalities may vary these. */
  fixedAssetTaxStandardRate: '1.4',
  cityPlanningTaxMaximumRate: '0.3',
  localInhabitantTaxOnIncome: '10',

  verification: STATUS.ESTIMATED,
  limitations: [
    'The non-resident withholding rate, consumption tax rate, fixed asset tax, city planning tax and inhabitant tax figures here have NOT been confirmed against a primary source in this pass and are marked estimated. They must be verified before any of them is presented as a verified calculation.',
    'Fixed asset tax and city planning tax are set by each municipality within statutory limits, and are charged on the assessed value on the tax roll as at 1 January.',
  ],
});

export const JP_RULES = Object.freeze([
  CGT_LONG_NATIONAL, CGT_LONG_LOCAL, CGT_SHORT_NATIONAL, CGT_SHORT_LOCAL,
  RECONSTRUCTION_SURTAX, INCOME_TAX,
  ACQUISITION_TAX_LAND, ACQUISITION_TAX_BUILDING_RESIDENTIAL, ACQUISITION_TAX_BUILDING_NONRESIDENTIAL,
  REGISTRATION_TAX_LAND_SALE, REGISTRATION_TAX_BUILDING_SALE,
]);
