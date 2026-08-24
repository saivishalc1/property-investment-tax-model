/**
 * depreciation.js — how a building is written off, per jurisdiction.
 *
 * The three markets this product researches disagree about depreciation more
 * fundamentally than they disagree about anything else, and the old model
 * flattened all of it into two numbers (27.5 and 39) applied everywhere:
 *
 *   United States  Straight-line MACRS over 27.5 years residential or 39
 *                  commercial, with a mid-month convention in the first year
 *                  and the year of disposal. Depreciation reduces basis and
 *                  comes back as unrecaptured section 1250 gain on sale.
 *
 *   United Kingdom NONE. An individual landlord gets no writing-down allowance
 *                  on a residential building at all. Modelling any depreciation
 *                  for a UK individual overstates their deductions every single
 *                  year, which is not a rounding difference — it is a deduction
 *                  that does not exist.
 *
 *   Japan          Statutory useful life by STRUCTURE and USE: 47 years for
 *                  reinforced concrete used residentially, 22 for wood, 34/27/19
 *                  for steel by frame thickness. A second-hand building — which
 *                  is most investment stock — uses a shortened life under
 *                  耐用年数省令3条. No mid-month convention.
 *
 * Returning "no depreciation" for the United Kingdom is a RESULT, not a gap.
 * The distinction matters: a gap means we do not know, and this is a case where
 * the law is known and the answer is nil.
 */

import { Decimal, ROUND } from '../core/decimal.js';
import { Money } from '../core/money.js';
import { trace, STATUS } from '../core/trace.js';
import { jurisdictionFor, COVERAGE } from './jurisdiction.js';
import { USEFUL_LIVES, usedBuildingUsefulLife } from '../rules/jurisdictions/jp.js';

/** Structures a user can choose in a Japanese scenario. */
export const JP_STRUCTURES = Object.freeze({
  reinforcedConcrete: '鉄筋コンクリート造 (reinforced concrete)',
  steelOver4mm: '金属造 4mm超 (steel, frame over 4mm)',
  steel3to4mm: '金属造 3–4mm (steel, frame 3–4mm)',
  steelUnder3mm: '金属造 3mm以下 (steel, frame under 3mm)',
  brickStoneBlock: 'れんが・石・ブロック造 (brick, stone or block)',
  wood: '木造 (wood)',
  woodMortar: '木骨モルタル造 (wood-frame mortar)',
});

const US_LIFE_RESIDENTIAL = '27.5';
const US_LIFE_COMMERCIAL = '39';

/**
 * The depreciation basis and annual allowance for a scenario.
 *
 * @param {object} scenario
 * @param {Money}  depreciableBasis building portion of cost, land already removed
 * @returns {{ allowed: boolean, life: Decimal|null, annual: Money,
 *             convention: string, trace: object }}
 */
export function computeDepreciation(scenario, depreciableBasis) {
  const j = jurisdictionFor(scenario?.meta?.preset);
  const isCommercial = scenario?.purchase?.propType === 'commercial';
  const currency = depreciableBasis.currency;

  const t = trace('depreciation', 'Depreciation allowance');
  t.input('depreciableBasis', depreciableBasis);

  if (j.coverage !== COVERAGE.MODELLED) {
    // No researched rules: fall back to nothing rather than to a US life.
    return {
      allowed: false,
      life: null,
      annual: Money.zero(currency),
      convention: 'none',
      trace: t.status(STATUS.UNSUPPORTED)
        .formula('not computed')
        .warn(j.reason)
        .result(Money.zero(currency))
        .build(),
    };
  }

  if (j.country === 'GB') return unitedKingdom(t, currency);
  if (j.country === 'JP') return japan(t, scenario, depreciableBasis, currency);
  if (j.country === 'US') return unitedStates(t, depreciableBasis, isCommercial, currency);

  return {
    allowed: false,
    life: null,
    annual: Money.zero(currency),
    convention: 'none',
    trace: t.status(STATUS.UNSUPPORTED)
      .formula('not computed')
      .warn(`No depreciation rule for ${j.country}.`)
      .result(Money.zero(currency))
      .build(),
  };
}

/* ------------------------------------------------------------------ */

function unitedStates(t, basis, isCommercial, currency) {
  const life = Decimal.of(isCommercial ? US_LIFE_COMMERCIAL : US_LIFE_RESIDENTIAL);
  const annual = Money.of(basis.amount.divide(life, 2, ROUND.HALF_UP), currency);

  t.formula('depreciable basis / recovery period (straight line, MACRS)')
    .line({
      label: isCommercial ? 'Non-residential real property' : 'Residential rental property',
      detail: `${life.toString()}-year recovery period, straight line`,
      base: basis,
      amount: annual,
    })
    .assume('Mid-month convention applies in the first year and the year of disposal.')
    .limitation('Land is excluded from the basis before this point; the land share you entered drives it.')
    .limitation('Cost segregation, bonus depreciation and section 179 are not modelled.')
    .result(annual);

  return { allowed: true, life, annual, convention: 'mid-month', trace: t.build() };
}

/**
 * The United Kingdom: nil, and that is a definite answer.
 *
 * The old model applied a 33.33-year life to UK commercial property and treated
 * UK residential as NO_DEP via a 1e9 sentinel. The commercial figure has no
 * basis in UK law for an individual landlord, and the sentinel produced a tiny
 * non-zero deduction rather than none.
 */
function unitedKingdom(t, currency) {
  const zero = Money.zero(currency);
  t.formula('no allowance')
    .line({
      label: 'No depreciation on the building',
      detail: 'UK individual landlords get no writing-down allowance on a residential building',
      amount: zero,
    })
    .limitation('Capital allowances may be available on qualifying plant and machinery within a commercial building. That is a separate regime and is not modelled.')
    .limitation('Capital expenditure generally adds to base cost for capital gains rather than being deducted against income.')
    .result(zero);

  // VERIFIED: this is the law, not an absence of information.
  return { allowed: false, life: null, annual: zero, convention: 'none', trace: t.status(STATUS.VERIFIED).build() };
}

function japan(t, scenario, basis, currency) {
  const purchase = scenario?.purchase || {};
  const structure = purchase.jpStructure || 'reinforcedConcrete';
  const table = USEFUL_LIVES[structure];

  if (!table) {
    return {
      allowed: false, life: null, annual: Money.zero(currency), convention: 'none',
      trace: t.status(STATUS.UNSUPPORTED)
        .formula('not computed')
        .warn(`Unknown Japanese structure "${structure}". Choose one of: ${Object.keys(JP_STRUCTURES).join(', ')}.`)
        .result(Money.zero(currency))
        .build(),
    };
  }

  const use = scenario?.purchase?.propType === 'commercial' ? 'office' : 'residential';
  const statutory = table[use];
  const ageYears = Math.max(0, Number(purchase.jpBuildingAgeYears) || 0);
  const life = ageYears > 0 ? usedBuildingUsefulLife(statutory, ageYears) : statutory;

  const lifeD = Decimal.of(String(life));
  const annual = Money.of(basis.amount.divide(lifeD, 0, ROUND.DOWN), currency);

  t.formula('depreciable basis / statutory useful life (定額法, straight line)')
    .line({
      label: table.label,
      detail: `${use === 'office' ? '事務所用 (office use)' : '住宅用 (residential use)'} — statutory life ${statutory} years`,
      base: basis,
      amount: null,
    });

  if (ageYears > 0) {
    t.line({
      label: 'Second-hand building (中古資産)',
      detail: `${ageYears} years elapsed at acquisition; shortened life ${life} years under 耐用年数省令3条`,
      amount: null,
    });
  }

  t.line({ label: 'Annual allowance', detail: `${basis.amount.toString()} / ${life}`, amount: annual })
    .limitation('Buildings acquired on or after 1 April 1998 use the straight-line method; the declining-balance method is not available for them.')
    .limitation('Building fixtures (建物附属設備) have their own shorter lives and are not separated out here.')
    .result(annual);

  if (!purchase.jpStructure) {
    t.status(STATUS.ASSUMPTION)
      .assume('Structure not specified; reinforced concrete assumed. A wooden building depreciates over 22 years rather than 47, which more than doubles the annual allowance.');
  }
  if (!purchase.jpBuildingAgeYears) {
    t.assume('Building age not specified; treated as new. Most Japanese investment stock is second-hand and depreciates far faster.');
  }

  return { allowed: true, life: lifeD, annual, convention: 'monthly', trace: t.build() };
}
