/**
 * jurisdiction.js — which preset corresponds to which modelled jurisdiction.
 *
 * Every market the product ships is backed by a researched rule pack. That was
 * not always so: it previously shipped twenty-three presets, of which three
 * were researched and twenty carried hand-entered rates with no effective
 * dates, no citations and no verification — and, because the old engine
 * ignored jurisdiction entirely, were silently charged United States federal
 * and New York State income tax on top. Those twenty were removed rather than
 * carried as a caveat, because a market a professional cannot show a client is
 * not a market.
 *
 * The coverage distinction survives, and is still enforced, because the guard
 * is what keeps a market from being added without the rules to back it:
 *
 *   MODELLED    a rule pack backs this, resolved by country, region, date and
 *               facts, with citations and a verification status
 *   LEGACY      no rule pack. The engine computes nothing and the interface
 *               renders a refusal rather than a number
 *
 * A LEGACY jurisdiction can never produce a verified result. Adding a preset
 * here without adding its rules produces an explicit unsupported result rather
 * than a wrong one.
 */

export const COVERAGE = Object.freeze({
  MODELLED: 'modelled',
  LEGACY: 'legacy',
});

/**
 * Presets backed by a researched rule pack.
 *
 * `region` and `locality` are the codes the registry resolves on, so adding a
 * jurisdiction here without adding its rules produces an explicit unsupported
 * result rather than a wrong number.
 */
const MODELLED = Object.freeze({
  'us-nyc': {
    country: 'US', region: 'US-NY', locality: 'NYC', currency: 'USD',
    label: 'New York City',
    authority: 'IRS, NYS Department of Taxation and Finance, NYC Department of Finance',
    // New York charges its property transfer taxes under transfer_tax. It has
    // no acquisition, registration or stamp tax, so their absence is not a gap.
    levies: ['transfer_tax'],
    knownGaps: [
      {
        side: 'acquisition',
        reason: 'Mortgage recording tax is not modelled. It is a real buyer-side cost in New York, varies by county, '
          + 'and is charged on the loan rather than the price — so cash at closing is understated for a financed purchase.',
      },
    ],
  },
  uk: {
    country: 'GB', region: 'GB-EAW', locality: null, currency: 'GBP',
    label: 'England & Northern Ireland',
    authority: 'HM Revenue & Customs',
    // SDLT is the only charge on acquiring UK land. There is no separate
    // registration or stamp tax on the transaction.
    levies: ['acquisition_tax'],
    knownGaps: [],
  },
  jp: {
    country: 'JP', region: 'JP-13', locality: null, currency: 'JPY',
    label: 'Japan (Tokyo)',
    authority: 'National Tax Agency, Tokyo Metropolitan Bureau of Taxation',
    // Japan also levies stamp tax on the contract, but we have no rule for it,
    // so it is declared as a known gap rather than listed here. Listing a
    // category we cannot resolve would mark every Japanese result unsupported
    // over a charge that is both small and already disclosed.
    levies: ['acquisition_tax', 'registration_tax'],
    knownGaps: [
      {
        side: 'acquisition',
        reason: 'Stamp tax (印紙税) on the sale contract is not modelled. It is a fixed amount by contract value and is '
          + 'small relative to the other charges, but it is a real cost and is currently omitted.',
      },
      {
        side: 'both',
        reason: 'Acquisition tax, registration tax and fixed asset tax are charged on 固定資産税評価額, the assessed value on '
          + 'the tax roll, not on the purchase price. Supplying the price overstates these charges, typically substantially.',
      },
    ],
  },
});

/**
 * Shown when a preset has no rule pack.
 *
 * No shipped market reaches this today. It is the guard for one added without
 * its rules, and it says what is actually missing rather than "unsupported".
 */
const LEGACY_REASON =
  'This location has no researched rule pack. Its rates were entered by hand with no effective dates, '
  + 'no source citations and no verification, and local and municipal variation is not modelled. '
  + 'Treat any figure as a rough sketch, not a calculation you can rely on or show a client.';

/** Regions of a modelled country that are deliberately not served. */
const DEVOLVED_NOTE = Object.freeze({
  uk: 'Covers England and Northern Ireland only. Scotland charges LBTT and Wales charges LTT, '
    + 'each with its own bands; neither is modelled and neither is served from the English tables.',
  jp: 'Prefectural and municipal rates are those of Tokyo. Another prefecture sets its own '
    + 'acquisition tax reliefs, and fixed asset and city planning taxes are municipal.',
  'us-nyc': 'Covers New York City. The city supplemental transfer tax schedule for residences of '
    + '$2,000,000 or more is not yet entered, so such a purchase understates the total transfer tax.',
});

/**
 * Resolve a preset key to a jurisdiction descriptor.
 *
 * Always returns a descriptor — never null — because the caller must be able
 * to render something honest for every preset, including the unmodelled ones.
 */
export function jurisdictionFor(presetKey) {
  const modelled = MODELLED[presetKey];
  if (modelled) {
    return Object.freeze({
      ...modelled,
      levies: Object.freeze([...(modelled.levies || [])]),
      knownGaps: Object.freeze([...(modelled.knownGaps || [])]),
      presetKey,
      coverage: COVERAGE.MODELLED,
      note: DEVOLVED_NOTE[presetKey] || null,
      reason: null,
    });
  }
  return Object.freeze({
    presetKey,
    country: null, region: null, locality: null, currency: null,
    label: null, authority: null,
    levies: Object.freeze([]),
    knownGaps: Object.freeze([]),
    coverage: COVERAGE.LEGACY,
    note: null,
    reason: LEGACY_REASON,
  });
}

/** True if a researched rule pack backs this preset. */
export function isModelled(presetKey) {
  return jurisdictionFor(presetKey).coverage === COVERAGE.MODELLED;
}

/** Every modelled preset key, for the interface to group or badge them. */
export function modelledPresetKeys() {
  return Object.keys(MODELLED);
}
