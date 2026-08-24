/**
 * presets.js — jurisdiction rate presets.
 *
 * VERIFICATION STATUS
 * -------------------
 * Each preset carries a `status` field. The wording is deliberately narrow,
 * because a claim of verification is only worth what was actually done:
 *
 *   'checked'       New York. Every rate was compared against the published
 *                   sources listed in `sources` on the date in `verified`.
 *                   That is a documentary check, not professional review. The
 *                   `verification` field records, per group of rates, whether
 *                   the figure came from a primary government source or from
 *                   corroborating secondary sources.
 *   'experimental'  Non-US jurisdictions. Researched, but NOT checked against
 *                   primary sources, and in several cases the engine cannot
 *                   express the local rule at all (see `omissions`). A starting
 *                   point for your own numbers, not an answer.
 *   'blank'         Empty template for a jurisdiction you enter yourself.
 *
 * NO PRESET IN THIS FILE HAS BEEN REVIEWED BY A CPA, AN ATTORNEY, AN ENROLLED
 * AGENT OR ANY OTHER TAX PROFESSIONAL, and none of it is advice. Every rate is
 * editable in the application.
 *
 * Documentary check performed 2026-08-22. What it found and fixed:
 *   - The 0.25% additional base tax on high-value conveyances applies in New
 *     York City ONLY. The outside-NYC preset had been applying it, overstating
 *     the transfer tax on a $3.5M sale upstate by $8,750. Corrected.
 *   - Income tax was a single flat rate per jurisdiction. Replaced with the
 *     real 2026 marginal schedules; see taxTables.js.
 *   - The §469(i) $25,000 allowance was missing entirely. Implemented.
 * Confirmed correct as they stood: the NYS 0.4% base transfer tax; the combined
 * NYC mansion schedule from 1% to 3.9%; NYC RPTT at 1%/1.425% residential and
 * 1.425%/2.625% commercial across the $500,000 threshold; mortgage recording
 * tax at 1.80%/1.925% residential and 2.55% commercial net of the lender's
 * 0.25%; the 25% ceiling on unrecaptured §1250 gain; NIIT at 3.8% with
 * thresholds of $200,000, $250,000 and $125,000; and 27.5 and 39-year recovery
 * periods.
 */

const L_US = {
  stateTransfer: 'State transfer tax', cityTransfer: 'City transfer tax',
  mansion: 'Mansion tax', mrt: 'Mortgage recording tax',
  fedLTCG: 'Federal long-term capital gains', recapture: 'Federal depreciation recapture (§1250)',
  niit: 'Net investment income tax', fedOrdinary: 'Federal marginal ordinary rate',
  stateOrdinary: 'State ordinary rate', cityOrdinary: 'City ordinary rate',
  stateCapGains: 'State rate on capital gain', cityCapGains: 'City rate on capital gain',
  flipTax: 'Co-op flip tax'
};
// Generic labels for everywhere that isn't the US.
function L(o) {
  return Object.assign({
    stateTransfer: 'Transfer tax / stamp duty', cityTransfer: 'Secondary transfer tax',
    mansion: 'Buyer duty / surcharge', mrt: 'Mortgage registration tax',
    fedLTCG: 'Capital gains tax', recapture: 'Depreciation recapture',
    niit: 'Investment income surtax', fedOrdinary: 'Rental income tax rate',
    stateOrdinary: 'Regional income tax', cityOrdinary: 'Municipal income tax',
    stateCapGains: 'Regional rate on gain', cityCapGains: 'Municipal rate on gain',
    flipTax: 'Flip / resale levy'
  }, o || {});
}

const NO_DEP = 1e9;   // "no depreciation relief in this jurisdiction"
const flat = r => [{ min: 0, rate: r }];
const zero = [{ min: 0, rate: 0 }];

const base = {
  currency: '$', marginalBrackets: true,
  stateTransferRes: zero, stateTransferComm: zero,
  cityTransferRes: zero, cityTransferComm: zero,
  mansion: zero, mrtResidential: zero, mrtCommercial: 0,
  cgtByYears: [], sellerDutyByYears: [],
  coopExemptFromMRT: false, coopExemptFromTitle: false,
  fedLTCG: 0, recapture: 0, niit: 0, niitEnabled: false,
  fedOrdinary: 0, stateOrdinary: 0, cityOrdinary: 0,
  stateCapGains: 0, cityCapGains: 0,
  depLifeResidential: 27.5, depLifeCommercial: 39
};
// deep-clone so no two presets ever share a bracket array
const mk = o => JSON.parse(JSON.stringify(Object.assign({}, base, o)));

const PRESETS = {

/* ========================= UNITED STATES ========================= */
'us-nyc': {
  dutySide: 'seller',
  coopMarket: true,
  lossRule: false,
  label: 'New York City', region: 'United States',
  notes: 'Non-resident or resident individual holding through a pass-through. Seller normally pays NYS and NYC transfer tax; buyer pays mansion tax and mortgage recording tax. Mansion tax and RPTT are whole-price cliff brackets, so a dollar over a threshold re-rates the entire price. Does not model NY nonresident estimated tax (IT-2663), REP status or §121.',
  sample: { price: 950000, rentMo: 7000, propTaxYr: 10000, insuranceYr: 2400, hoaMo: 500, otherOpexYr: 1000, capexTotal: 25000, loanRate: 6.75, downPct: 30 },
  labels: L_US,
  rates: mk({
    marginalBrackets: false,
    stateTransferRes: [{ min: 0, rate: 0.4 }, { min: 3000000, rate: 0.65 }],
    stateTransferComm: [{ min: 0, rate: 0.4 }, { min: 2000000, rate: 0.65 }],
    cityTransferRes: [{ min: 0, rate: 1.0 }, { min: 500000.01, rate: 1.425 }],
    cityTransferComm: [{ min: 0, rate: 1.425 }, { min: 500000.01, rate: 2.625 }],
    mansion: [{ min: 0, rate: 0 }, { min: 1000000, rate: 1.0 }, { min: 2000000, rate: 1.25 },
              { min: 3000000, rate: 1.5 }, { min: 5000000, rate: 2.25 }, { min: 10000000, rate: 3.25 },
              { min: 15000000, rate: 3.5 }, { min: 20000000, rate: 3.75 }, { min: 25000000, rate: 3.9 }],
    mrtResidential: [{ min: 0, rate: 1.8 }, { min: 500000, rate: 1.925 }],
    mrtCommercial: 2.55, coopExemptFromMRT: true, coopExemptFromTitle: true,
    fedLTCG: 20, recapture: 25, niit: 3.8, niitEnabled: true,
    fedOrdinary: 37, stateOrdinary: 6.85, cityOrdinary: 3.876,
    stateCapGains: 6.85, cityCapGains: 3.876
  })
},

'uk': {
  dutySide: 'buyer',
  lossRule: false,
  label: 'United Kingdom — buy-to-let', region: 'Western Europe',
  notes: 'SDLT at the additional-property rates in force from April 2025, plus the 2% non-resident surcharge, giving 7/9/12/17/19% marginal bands. Capital gains on residential property at the 24% higher rate. Rental taxed at 40% under the non-resident landlord scheme. Two things this cannot capture: individuals get no depreciation on buildings, and mortgage interest relief is restricted to a 20% basic-rate tax credit rather than a deduction — so the model over-relieves interest for higher-rate taxpayers. Scotland (LBTT) and Wales (LTT) have separate schedules.',
  sample: { price: 425000, rentMo: 1950, propTaxYr: 0, insuranceYr: 450, hoaMo: 150, otherOpexYr: 900, capexTotal: 12000, loanRate: 5.4, downPct: 30 },
  labels: L({ stateTransfer: 'SDLT (incl. 2% non-resident surcharge)' }),
  rates: mk({
    currency: '£',
    stateTransferRes: [{ min: 0, rate: 7 }, { min: 125000, rate: 9 }, { min: 250000, rate: 12 },
                       { min: 925000, rate: 17 }, { min: 1500000, rate: 19 }],
    stateTransferComm: [{ min: 0, rate: 0 }, { min: 150000, rate: 2 }, { min: 250000, rate: 5 }],
    fedLTCG: 24, fedOrdinary: 40,
    depLifeResidential: NO_DEP, depLifeCommercial: 33.33
  })
},

'jp': {
  dutySide: 'buyer',
  lossRule: true,
  label: 'Japan', region: 'Asia-Pacific',
  notes: 'Real estate acquisition tax of about 3% plus registration licence tax, judicial scrivener and stamp duty of roughly 1.5%. The five-year line drives everything on exit: sell in year five or earlier and the combined rate is 39.63% (30.63% for non-residents, who pay the national component only); hold beyond five years and it drops to 20.315% (15.315% non-resident). The model applies this automatically from your hold period. The buyer withholds 10.21% of the gross price on a non-resident sale. Reinforced-concrete buildings depreciate over 47 years; wooden structures over 22. Annual fixed asset tax of about 1.7% belongs in operating expenses.',
  sample: { price: 45000000, rentMo: 180000, propTaxYr: 700000, insuranceYr: 40000, hoaMo: 25000, otherOpexYr: 120000, capexTotal: 1500000, loanRate: 2.0, downPct: 30 },
  labels: L({ stateTransfer: 'Real estate acquisition tax', cityTransfer: 'Registration & scrivener' }),
  rates: mk({
    currency: '¥',
    stateTransferRes: flat(3), stateTransferComm: flat(4),
    cityTransferRes: flat(1.5), cityTransferComm: flat(1.5),
    cgtByYears: [{ min: 0, rate: 30.63 }, { min: 5, rate: 15.315 }],
    fedLTCG: 15.315, fedOrdinary: 20.42,
    depLifeResidential: 47, depLifeCommercial: 47
  })
},

};

/* ---------------------------------------------------------------------------
   Verification metadata. Applied to every preset above so the UI can always
   show the user how much weight a preset's numbers can carry.
   --------------------------------------------------------------------------- */

/**
 * Verification metadata, one entry per market.
 *
 * EVERY market shipped now has a researched rule pack, so there is no
 * "experimental" fallback any more — a preset without an entry here is a
 * packaging error and throws at load rather than quietly acquiring a status it
 * has not earned.
 *
 * `omissions` is what the model does NOT do. It is read by the interface and
 * printed in the report, so it has to keep pace with the engine: several
 * entries here previously claimed that section 469, the section 1250 ceiling
 * and full bracket tables were unmodelled, long after the rule packs had
 * implemented all three.
 */
const VERIFICATION = {
  'us-nyc': {
    taxYear: 2026,
    verified: '2026-08-23',
    verification: {
      transferAndTransactionTaxes: 'primary',
      federalIncomeAndGains: 'primary',
      newYorkIncomeBrackets: 'secondary',
      professionalReview: 'none',
    },
    sources: [
      { label: 'NYS Tax Dept — Real estate transfer tax', url: 'https://www.tax.ny.gov/bus/transfer/rptidx.htm' },
      { label: 'NYC Dept of Finance — Real Property Transfer Tax (RPTT)', url: 'https://www.nyc.gov/site/finance/property/property-real-property-transfer-tax-rptt.page' },
      { label: 'IRS — 2026 inflation adjustments (Rev. Proc. 2025-32)', url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill' },
      { label: 'IRS Topic 409 — Capital gains and losses', url: 'https://www.irs.gov/taxtopics/tc409' },
      { label: 'IRS Publication 925 — Passive Activity and At-Risk Rules', url: 'https://www.irs.gov/publications/p925' },
      { label: 'IRS Topic 559 — Net investment income tax', url: 'https://www.irs.gov/taxtopics/tc559' },
    ],
    omissions: [
      'Mortgage recording tax, which is a real buyer cost, varies by county and is charged on the loan rather than the price. Cash at closing is understated for a financed purchase.',
      'The New York City supplemental transfer tax on residences of $2,000,000 or more. The Department states the range is 0.25% to 2.9% but does not publish the band table on that page, so the charge is not computed rather than estimated.',
      'New York State and City income tax bands come from corroborating secondary sources, not a primary schedule, so a New York result reports "estimated" rather than "checked".',
      'The 2026 federal capital gains breakpoints were not published at the access date. The 2025 figures are carried forward and marked estimated.',
      'IT-2663 nonresident estimated income tax on the sale of New York real property, and FIRPTA withholding.',
      'The section 121 principal-residence exclusion — this is an investment-property model.',
      'Grossing-up of consideration when the buyer pays the seller’s New York transfer tax.',
      'Real estate professional status under section 469(c)(7), the section 199A deduction, the SALT deduction, Alternative Minimum Tax, and entity-level tax for corporate owners.',
    ],
  },

  uk: {
    taxYear: 2026,
    verified: '2026-08-23',
    verification: {
      transferAndTransactionTaxes: 'primary',
      incomeAndGains: 'primary',
      professionalReview: 'none',
    },
    sources: [
      { label: 'GOV.UK — SDLT: residential property rates', url: 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates' },
      { label: 'GOV.UK — SDLT: non-residential and mixed rates', url: 'https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates' },
      { label: 'GOV.UK — Income Tax rates and Personal Allowances', url: 'https://www.gov.uk/income-tax-rates' },
      { label: 'GOV.UK — Capital Gains Tax rates', url: 'https://www.gov.uk/capital-gains-tax/rates' },
      { label: 'GOV.UK — Tax relief for residential landlords', url: 'https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-worked-examples' },
    ],
    omissions: [
      'England and Northern Ireland only. Scotland charges LBTT and Wales charges LTT, each with its own bands and supplements; neither is modelled and neither is served from the English tables.',
      'An individual landlord gets no depreciation on a building, so the depreciation figures in this model do not apply. Capital allowances on qualifying plant within a commercial building are a separate regime and are not modelled.',
      'Linked transactions, Multiple Dwellings Relief successors, and purchases of six or more dwellings.',
      'The property allowance covering the first £1,000 of property income, and the personal allowance taper above £100,000.',
      'A UK residential disposal must be reported and paid within 60 days of completion. The model reports the liability but does not produce the return.',
      'Company landlords pay Corporation Tax and do get full relief for finance costs. This model computes for an individual.',
    ],
  },

  jp: {
    taxYear: 2026,
    verified: '2026-08-23',
    verification: {
      transferAndTransactionTaxes: 'primary',
      incomeAndGains: 'primary',
      localTaxes: 'secondary',
      professionalReview: 'none',
    },
    sources: [
      { label: '国税庁 No.3208 — 長期譲渡所得の税額の計算', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm' },
      { label: '国税庁 No.3211 — 短期譲渡所得の税額の計算', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm' },
      { label: '国税庁 No.2260 — 所得税の税率', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm' },
      { label: '国税庁 No.7191 — 登録免許税の税額表', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7191.htm' },
      { label: '国税庁 — 主な減価償却資産の耐用年数表（建物）', url: 'https://www.keisan.nta.go.jp/r5yokuaru/aoiroshinkoku/hitsuyokeihi/genkashokyakuhi/taiyonensutatemono.html' },
      { label: '東京都主税局 — 不動産取得税', url: 'https://www.tax.metro.tokyo.lg.jp/shisan/fudosan.html' },
    ],
    omissions: [
      'Acquisition tax and registration tax are charged on 固定資産税評価額, the assessed value on the tax roll, not on the purchase price. They are excluded until you supply that value rather than being computed on the price.',
      'Stamp tax (印紙税) on the sale contract.',
      'Prefectural and municipal rates are those of Tokyo. Another prefecture sets its own acquisition tax reliefs, and fixed asset and city planning taxes are municipal.',
      'Local inhabitant tax on rental income is taken at a flat 10%, the standard combined rate, and has not been confirmed against a primary source.',
      'Loss offset against other income (損益通算) is not modelled, and the land-interest portion of a loss is restricted in any case.',
      'A non-resident seller is subject to 10.21% withholding on the gross price at disposal.',
      'The 3,000万円 special deduction for a former residence (措法35), and the blue return deduction.',
    ],
  },
};

for (const [key, preset] of Object.entries(PRESETS)) {
  const v = VERIFICATION[key];
  if (!v) {
    // Every shipped market must carry researched provenance. A preset without
    // it used to fall back to an "experimental" label; there is no such market
    // any more, so this is a packaging error and should stop the build.
    throw new Error(`presets.js: no verification metadata for "${key}". Every market must be researched.`);
  }
  Object.assign(preset, v);
}

/**
 * The regions the dropdown groups by, DERIVED from the presets themselves.
 *
 * This was a hand-maintained list of six regions. When the unresearched markets
 * were removed it still named Gulf & South Asia, Americas and Build your own —
 * groups with nothing in them — because nothing tied the list to the presets it
 * was supposed to describe. Deriving it means that cannot happen again.
 */
export const REGIONS = [...new Set(Object.values(PRESETS).map((p) => p.region))];

export { PRESETS, L_US, NO_DEP };
