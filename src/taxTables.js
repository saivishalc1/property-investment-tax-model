/**
 * taxTables.js — LEGACY statutory rate schedules.
 *
 * SUPERSEDED, AND STILL LOAD-BEARING. These tables are the original engine's
 * rate source. They are still consulted by calculations.js for rental income
 * tax, capital gains and depreciation recapture, so they cannot simply be
 * deleted — but nothing new should be added here.
 *
 * The replacement is src/rules/, where every rate carries a jurisdiction,
 * effective dates, a citation with an access date, a verification status and
 * declared limitations, and is resolved through the registry rather than being
 * reached by a function that ignores which country the property is in.
 *
 * TWO THINGS TO KNOW BEFORE TRUSTING ANYTHING BELOW.
 *
 * These tables apply UNCONDITIONALLY, whatever market the user selected. The
 * old tablesFor() takes a filing status and nothing else, so a Japanese or
 * British scenario is charged United States federal and New York State income
 * tax by this file. That is the defect the rule registry was built to remove,
 * and it is still live on the hold and sale path.
 *
 * The capital gains thresholds are labelled 2026 but are the 2025 figures. IRS
 * Topic 409 had not published the 2026 schedule at the time of reading, and
 * these were carried forward and marked "provisional". src/rules/jurisdictions/
 * us-ny.js handles the same gap honestly instead: the 2025 table EXPIRES on
 * 2025-12-31, so a 2026 disposal resolves to no rule and is reported as a gap.
 *
 * Original provenance notes follow.
 *
 * PROVENANCE. Every table below records where its numbers came from and how
 * firmly. This matters more than the numbers: a rate you cannot trace is a rate
 * you cannot defend to a client.
 *
 *   federalOrdinary   IRS, "IRS releases tax inflation adjustments for tax year
 *                     2026, including amendments from the One, Big, Beautiful
 *                     Bill" — read directly, 2026-08-22.
 *   federalLTCG       IRS Topic 409 — read directly, 2026-08-22. Topic 409
 *                     published the 2025 thresholds at the time of reading; the
 *                     2026 figures here are those thresholds and are marked
 *                     provisional until the 2026 schedule is published.
 *   newYorkState      NY Tax Law §601 as amended by Chapter 59 of the Laws of
 *                     2025. NYS Publication NYS-50-T-NYS (1/26) confirms rate
 *                     reductions took effect for 2026 but embeds them in
 *                     withholding formulas rather than publishing a schedule;
 *                     the brackets here were taken from two independent
 *                     secondary sources that agree exactly, and are marked as
 *                     secondary-sourced.
 *   newYorkCity       NYC resident schedule, 3.078%–3.876%. The Department's own
 *                     TSB-M-10(7)I is marked obsolete; thresholds corroborated
 *                     from secondary sources. Above $90,000 of taxable income
 *                     the rate is a flat 3.876%, which is where any investor
 *                     this model is aimed at will sit.
 *
 * Brackets are [{ min, rate }] ascending, rate in percent, and are always
 * marginal — each slice of income is taxed at its own rate. They are NOT the
 * whole-price cliff tables used for transfer taxes; see calculations.js.
 */

export const TAX_YEAR = 2026;

/** Confidence in each table, surfaced in the interface. */
export const TABLE_SOURCES = {
  federalOrdinary: { confidence: 'primary', cite: 'IRS 2026 inflation adjustments (Rev. Proc. 2025-32)', url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill' },
  federalLTCG: { confidence: 'provisional', cite: 'IRS Topic 409 — thresholds as published at time of reading', url: 'https://www.irs.gov/taxtopics/tc409' },
  newYorkState: { confidence: 'secondary', cite: 'NY Tax Law §601 as amended by Ch. 59, L. 2025; schedule from corroborating secondary sources', url: 'https://www.tax.ny.gov/bus/wt/rate.htm' },
  newYorkCity: { confidence: 'secondary', cite: 'NYC resident schedule 3.078%–3.876%', url: 'https://www.tax.ny.gov/pdf/memos/income/m10_7i.pdf' },
};

export const FEDERAL_ORDINARY = {
  single: [
    { min: 0, rate: 10 }, { min: 12400, rate: 12 }, { min: 50400, rate: 22 },
    { min: 105700, rate: 24 }, { min: 201775, rate: 32 }, { min: 256225, rate: 35 },
    { min: 640600, rate: 37 },
  ],
  mfj: [
    { min: 0, rate: 10 }, { min: 24800, rate: 12 }, { min: 100800, rate: 22 },
    { min: 211400, rate: 24 }, { min: 403550, rate: 32 }, { min: 512450, rate: 35 },
    { min: 768700, rate: 37 },
  ],
  // Married filing separately mirrors half the joint brackets.
  mfs: [
    { min: 0, rate: 10 }, { min: 12400, rate: 12 }, { min: 50400, rate: 22 },
    { min: 105700, rate: 24 }, { min: 201775, rate: 32 }, { min: 256225, rate: 35 },
    { min: 384350, rate: 37 },
  ],
};

export const FEDERAL_LTCG = {
  single: [{ min: 0, rate: 0 }, { min: 48350, rate: 15 }, { min: 533400, rate: 20 }],
  mfj: [{ min: 0, rate: 0 }, { min: 96700, rate: 15 }, { min: 600050, rate: 20 }],
  mfs: [{ min: 0, rate: 0 }, { min: 48350, rate: 15 }, { min: 300025, rate: 20 }],
};

export const NEW_YORK_STATE = {
  single: [
    { min: 0, rate: 3.9 }, { min: 8500, rate: 4.4 }, { min: 11700, rate: 5.15 },
    { min: 13900, rate: 5.4 }, { min: 80650, rate: 5.9 }, { min: 215400, rate: 6.85 },
    { min: 1077550, rate: 9.65 }, { min: 5000000, rate: 10.3 }, { min: 25000000, rate: 10.9 },
  ],
  mfj: [
    { min: 0, rate: 3.9 }, { min: 17150, rate: 4.4 }, { min: 23600, rate: 5.15 },
    { min: 27900, rate: 5.4 }, { min: 161550, rate: 5.9 }, { min: 323200, rate: 6.85 },
    { min: 2155350, rate: 9.65 }, { min: 5000000, rate: 10.3 }, { min: 25000000, rate: 10.9 },
  ],
};
NEW_YORK_STATE.mfs = NEW_YORK_STATE.single;

export const NEW_YORK_CITY = {
  single: [
    { min: 0, rate: 3.078 }, { min: 12000, rate: 3.762 },
    { min: 25000, rate: 3.819 }, { min: 50000, rate: 3.876 },
  ],
  mfj: [
    { min: 0, rate: 3.078 }, { min: 21600, rate: 3.762 },
    { min: 45000, rate: 3.819 }, { min: 90000, rate: 3.876 },
  ],
};
NEW_YORK_CITY.mfs = NEW_YORK_CITY.single;

/**
 * §469(i) special allowance: up to $25,000 of rental losses deductible against
 * non-passive income for an actively participating individual, reduced by 50
 * cents per dollar of MAGI above $100,000 and gone entirely at $150,000.
 * Married filing separately gets half, and only if the spouses lived apart for
 * the whole year — this model assumes they did not, which is the safer default.
 *
 * Source: IRS Publication 925, read directly 2026-08-22.
 */
export const SECTION_469_ALLOWANCE = {
  single: { max: 25000, phaseStart: 100000 },
  mfj: { max: 25000, phaseStart: 100000 },
  mfs: { max: 0, phaseStart: 0 },
};
