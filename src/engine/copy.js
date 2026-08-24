/**
 * copy.js — jurisdiction-appropriate wording for the interface.
 *
 * WHY THIS EXISTS. The interface was written for New York and its help text
 * says so, everywhere, whatever market is selected. Before this file, a user
 * modelling a flat in Manchester was told:
 *
 *   "Commercial property depreciates over 39 years instead of 27.5."
 *   "Seller (standard in New York)"
 *   "New York City resident for income tax"
 *   "The IRS mid-month convention gives you half a month of depreciation."
 *   "Under US §469 a rental loss is passive."
 *   "FIRPTA withholding ... are not modelled."
 *
 * Every one of those is a United States rule. None of them applies to a UK or
 * Japanese purchase, and several are actively misleading: an individual UK
 * landlord gets no depreciation on a building at all, and there is no §469.
 *
 * Wrong help text is not cosmetic. It is a statement about the law, presented
 * in the same voice as the numbers, and a reader has no way to tell which
 * parts of the page were localised and which were left behind.
 *
 * Controls that are meaningless outside the United States are HIDDEN rather
 * than reworded — the New York City residency switch has no analogue in Tokyo,
 * and offering it there would invite an answer that changes nothing.
 */

import { jurisdictionFor, COVERAGE } from './jurisdiction.js';

/**
 * Per-market wording. Keys are element ids; values are the text to apply.
 *
 * `null` means "hide this element entirely" — the concept does not exist here.
 */
const COPY = {
  'us-nyc': {
    propTypeHelp: 'Co-op shares are personal property: no title insurance and no mortgage recording tax, but a flip tax on sale. Commercial property depreciates over 39 years instead of 27.5.',
    buyTransferSellerLabel: 'Seller (standard in New York)',
    sellTransferSellerLabel: 'You, the seller (standard in New York)',
    quickRatesHeading: 'Using the standard New York rates',
    'f-serviceMonth-help': 'The IRS mid-month convention gives you half a month of depreciation in the month it is first available to rent.',
    'f-capexMonth-help': 'The IRS mid-month convention treats it as placed in service halfway through this month.',
    nycResidentRow: true,
    // Sections 469, 469(i), 469(g) and 1411 are United States statutes.
    passiveLossRow: true,
    activeParticipationRow: true,
    fullDispositionRow: true,
    niitRow: true,
    exchangeSection: true,
    buyTransferHelp: 'On new construction and sponsor sales the buyer usually absorbs the New York State and New York City transfer tax. When the buyer pays, it capitalises into your cost basis.',
    'tip-land': 'Land never wears out, so it cannot be depreciated. Only the building portion of your cost basis generates a depreciation deduction. Your property tax assessment usually shows a land and improvement split; 20–30% is typical in New York City.',
  },

  uk: {
    propTypeHelp: 'An individual landlord gets NO depreciation on a building in the United Kingdom — the depreciation figures in this model do not apply to you. Residential and commercial purchases are taxed under different SDLT tables.',
    buyTransferSellerLabel: 'Seller',
    sellTransferSellerLabel: 'You, the seller',
    quickRatesHeading: 'Using the published UK rates',
    'f-serviceMonth-help': 'Used for the depreciation timing in this model. UK individuals get no building depreciation, so it does not affect a UK figure.',
    'f-capexMonth-help': 'Used for the depreciation timing in this model. Capital expenditure on a UK residential let is generally added to base cost for capital gains rather than deducted.',
    // Stamp Duty Land Tax is always paid by the buyer; there is no election.
    nycResidentRow: false,
    // No United States statute applies to a British property. Showing a
    // passive-loss switch that changes nothing is worse than not showing it:
    // it implies the model is applying a rule it is not.
    passiveLossRow: false,
    activeParticipationRow: false,
    fullDispositionRow: false,
    niitRow: false,
    exchangeSection: false,
    buyTransferHelp: 'SDLT is payable by the buyer. There is no election, and it is not deductible against rental income — it forms part of your base cost for capital gains.',
    'tip-land': 'An individual landlord gets no depreciation on a UK building, so the land share does not affect a UK figure. It is kept because it still describes the property.',
  },

  jp: {
    propTypeHelp: 'Depreciation in Japan runs on the statutory useful life for the building’s structure and use — 47 years for reinforced concrete used residentially, 22 for wood. A second-hand building uses a shortened life. The 27.5 and 39 year figures are United States rules and do not apply.',
    buyTransferSellerLabel: 'Seller',
    sellTransferSellerLabel: 'You, the seller',
    quickRatesHeading: 'Using the published Japanese rates',
    passiveLossRow: false,
    activeParticipationRow: false,
    fullDispositionRow: false,
    niitRow: false,
    exchangeSection: false,
    buyTransferHelp: 'Acquisition tax and registration tax are payable by the buyer, and are charged on the assessed value on the tax roll rather than the price.',
    'tip-land': 'Only the building is depreciated in Japan; land is not. The building share drives the annual allowance over the statutory useful life for its structure.',
    'f-serviceMonth-help': 'Japan depreciates from the month the asset is placed in service; there is no mid-month convention.',
    'f-capexMonth-help': 'Japan depreciates from the month the improvement is placed in service; there is no mid-month convention.',
    nycResidentRow: false,
  },
};

/** Fallback wording for a market with no researched rule pack. */
const UNRESEARCHED = {
  propTypeHelp: 'Depreciation lives, transfer taxes and who pays them differ by country. This market has no researched rule pack, so the figures below use whatever rates the preset carries.',
  buyTransferSellerLabel: 'Seller',
  sellTransferSellerLabel: 'You, the seller',
  quickRatesHeading: 'Using the preset’s rates',
  passiveLossRow: false,
  activeParticipationRow: false,
  fullDispositionRow: false,
  niitRow: false,
  exchangeSection: false,
  buyTransferHelp: 'Who pays a transfer tax differs by country and has not been checked for this market.',
  'tip-land': 'Only the building portion of a cost basis is depreciated where depreciation is available at all.',
  'f-serviceMonth-help': 'Used for the depreciation timing in this model. Whether it matches local law here has not been checked.',
  'f-capexMonth-help': 'Used for the depreciation timing in this model. Whether it matches local law here has not been checked.',
  nycResidentRow: false,
};

/**
 * Apply the wording for the current market.
 *
 * @param {string} presetKey
 * @param {(sel: string) => Element|null} $ the app's element lookup
 */
export function applyCopy(presetKey, $) {
  const j = jurisdictionFor(presetKey);
  const copy = COPY[presetKey] || UNRESEARCHED;

  for (const [id, value] of Object.entries(copy)) {
    const node = $(`#${id}`);
    if (!node) continue;

    if (typeof value === 'boolean') {
      // A control that does not exist in this jurisdiction is removed from the
      // form rather than shown and ignored.
      node.hidden = !value;
      continue;
    }
    node.textContent = value;
  }

  // The document title and the header subtitle both name New York in the
  // markup. They are the first thing a reader sees and the last thing anyone
  // remembers to change.
  const marketName = j.coverage === COVERAGE.MODELLED ? j.label : null;
  const title = $('title');
  if (title) {
    title.textContent = marketName
      ? `Property Investment Tax Model — ${marketName} investment property planner`
      : 'Property Investment Tax Model — investment property planner';
  }
  return j;
}

/**
 * Is a United States-only concept in play?
 *
 * Used to gate the §469 passive-loss controls, the FIRPTA note and the
 * §1031 exchange comparison, none of which exist outside the United States.
 */
export function isUnitedStates(presetKey) {
  const j = jurisdictionFor(presetKey);
  return j.country === 'US' || String(presetKey).startsWith('us-');
}
