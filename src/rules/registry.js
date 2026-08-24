/**
 * registry.js — resolve which rule applies to a given set of facts.
 *
 * THIS IS THE PIECE THAT MAKES THE ORIGINAL BUG UNEXPRESSIBLE.
 *
 * The previous engine reached its rate tables through a function that took a
 * filing status and returned United States federal, New York State and New
 * York City brackets — unconditionally, with no jurisdiction parameter at all.
 * A Japanese scenario was therefore charged New York State income tax, and
 * nothing in the code could notice, because nothing in the code was ever asked
 * which country it was in.
 *
 * Here, a rule is only ever reached by asking for a (country, category, date,
 * facts) combination, and the registry answers in exactly one of three ways:
 *
 *   a matching rule          — proceed
 *   UNSUPPORTED              — no rule covers this; the engine must not invent
 *                              a number, and the interface must say so
 *   AMBIGUOUS (throws)       — two rules match equally well, which is a defect
 *                              in the rule pack and must fail loudly at once
 *
 * There is no fourth branch that quietly picks a default. That absence is the
 * whole design.
 */

import { isInForce, appliesTo, specificity } from './schema.js';
import { STATUS } from '../core/trace.js';

/** Regions we know about and deliberately refuse to serve from a neighbour's tables. */
export class UnsupportedJurisdictionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'UnsupportedJurisdictionError';
    this.detail = detail;
  }
}

export class AmbiguousRuleError extends Error {
  constructor(message, candidates) {
    super(message);
    this.name = 'AmbiguousRuleError';
    this.candidates = candidates;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RuleRegistry {
  #rules = [];
  #declaredUnsupported = [];

  /** Register rules. Ids must be unique — a duplicate is a packaging error. */
  add(rules) {
    for (const rule of [].concat(rules)) {
      const clash = this.#rules.find((r) => r.id === rule.id && r.version === rule.version);
      if (clash) throw new Error(`RuleRegistry: duplicate rule ${rule.id}@${rule.version}`);
      this.#rules.push(rule);
    }
    return this;
  }

  /**
   * Declare a jurisdiction we know exists and deliberately do not cover.
   *
   * Declaring is not the same as staying silent. A declared gap produces a
   * specific, citable refusal naming the right authority; an undeclared one
   * would produce a generic "no rule found". Scotland and Wales are declared
   * so a user is told about LBTT and LTT by name.
   */
  declareUnsupported(entry) {
    this.#declaredUnsupported.push(Object.freeze({ ...entry }));
    return this;
  }

  get rules() { return [...this.#rules]; }

  /**
   * Find the single rule that applies, or explain why none does.
   *
   * @param {object} q
   * @param {string} q.country   ISO 3166-1 alpha-2
   * @param {string} [q.region]
   * @param {string} [q.locality]
   * @param {string} q.category  a CATEGORY value
   * @param {string} q.on        ISO date the transaction or tax year sits on
   * @param {object} [q.facts]   propertyClass, ownership, residency, filingStatus
   * @returns {{ rule: object|null, unsupported: object|null }}
   */
  resolve(q) {
    if (!q || typeof q.country !== 'string') throw new TypeError('resolve: country is required');
    if (typeof q.category !== 'string') throw new TypeError('resolve: category is required');
    if (!ISO_DATE.test(q.on || '')) throw new TypeError('resolve: `on` must be an ISO date');
    const facts = q.facts || {};

    // A declared gap wins over a generic miss, and over any broader rule that
    // would otherwise be applied to it by accident.
    const declared = this.#declaredUnsupported.find(
      (d) => d.country === q.country && (d.region == null || d.region === q.region),
    );
    if (declared && (declared.category == null || declared.category === q.category)) {
      return {
        rule: null,
        unsupported: {
          reason: declared.reason,
          authority: declared.authority || null,
          url: declared.url || null,
          jurisdiction: `${q.country}${q.region ? `/${q.region}` : ''}`,
        },
      };
    }

    const candidates = this.#rules.filter((r) => {
      if (r.jurisdiction.country !== q.country) return false;
      if (r.category !== q.category) return false;
      // A rule scoped to a region only applies within it; a rule with no region
      // is national and applies anywhere in the country.
      if (r.jurisdiction.region && r.jurisdiction.region !== q.region) return false;
      if (r.jurisdiction.locality && r.jurisdiction.locality !== q.locality) return false;
      if (!isInForce(r, q.on)) return false;
      if (!appliesTo(r, facts)) return false;
      return true;
    });

    if (candidates.length === 0) {
      return {
        rule: null,
        unsupported: {
          reason: `No ${q.category} rule is in force for ${q.country}${q.region ? `/${q.region}` : ''} on ${q.on}`
            + `${describeFacts(facts)}. The model will not substitute a rule from another jurisdiction or another date.`,
          authority: null,
          url: null,
          jurisdiction: `${q.country}${q.region ? `/${q.region}` : ''}`,
        },
      };
    }

    // A composite charge has several components that all apply. resolve()
    // answers for ONE component; if the query does not name one and several
    // exist, that is a question with more than one answer and the caller
    // wanted resolveAll().
    const components = new Set(candidates.map((r) => r.component));
    if (q.component == null && components.size > 1) {
      throw new AmbiguousRuleError(
        `RuleRegistry: ${q.country}/${q.category} on ${q.on} is a composite charge with components `
        + `${[...components].sort().join(', ')}. Pass { component } to select one, or call resolveAll() `
        + 'to get every component of the bill.',
        [...components].sort(),
      );
    }
    const inComponent = q.component == null
      ? candidates
      : candidates.filter((r) => r.component === q.component);

    if (inComponent.length === 0) {
      return {
        rule: null,
        unsupported: {
          reason: `No ${q.category} rule with component "${q.component}" is in force for ${q.country} on ${q.on}.`,
          authority: null, url: null,
          jurisdiction: `${q.country}${q.region ? `/${q.region}` : ''}`,
        },
      };
    }
    return { rule: pickMostSpecific(inComponent, q), unsupported: null };
  }

  /**
   * Every component of a composite charge.
   *
   * Japan's capital gains bill is national tax plus local inhabitant tax; the
   * surtax is computed on the national figure and so is applied by the engine
   * rather than returned here. A UK commercial lease can attract both a premium
   * charge and a net-present-value charge. Returning them as a list is what
   * lets the report show a reader the bill the way they will actually receive
   * it, rather than as one merged number.
   */
  resolveAll(q) {
    if (!q || typeof q.country !== 'string') throw new TypeError('resolveAll: country is required');
    if (!ISO_DATE.test(q.on || '')) throw new TypeError('resolveAll: `on` must be an ISO date');

    const declared = this.#declaredUnsupported.find(
      (d) => d.country === q.country && (d.region == null || d.region === q.region),
    );
    if (declared && (declared.category == null || declared.category === q.category)) {
      return {
        rules: [],
        unsupported: {
          reason: declared.reason,
          authority: declared.authority || null,
          url: declared.url || null,
          jurisdiction: `${q.country}${q.region ? `/${q.region}` : ''}`,
        },
      };
    }

    const facts = q.facts || {};
    const matching = this.#rules.filter((r) => {
      if (r.jurisdiction.country !== q.country) return false;
      if (r.category !== q.category) return false;
      if (r.jurisdiction.region && r.jurisdiction.region !== q.region) return false;
      if (r.jurisdiction.locality && r.jurisdiction.locality !== q.locality) return false;
      if (!isInForce(r, q.on)) return false;
      if (!appliesTo(r, facts)) return false;
      return true;
    });

    const byComponent = new Map();
    for (const r of matching) {
      if (!byComponent.has(r.component)) byComponent.set(r.component, []);
      byComponent.get(r.component).push(r);
    }
    const rules = [...byComponent.entries()]
      .map(([, group]) => pickMostSpecific(group, q))
      .sort((a, b) => a.component.localeCompare(b.component));

    if (rules.length === 0) {
      return {
        rules: [],
        unsupported: {
          reason: `No ${q.category} rule is in force for ${q.country}${q.region ? `/${q.region}` : ''} on ${q.on}`
            + `${describeFacts(facts)}. The model will not substitute a rule from another jurisdiction or another date.`,
          authority: null, url: null,
          jurisdiction: `${q.country}${q.region ? `/${q.region}` : ''}`,
        },
      };
    }
    return { rules, unsupported: null };
  }

  /**
   * Resolve or throw. For call sites where proceeding without a rule would be
   * a programming error rather than a user-facing gap.
   */
  require(q) {
    const { rule, unsupported } = this.resolve(q);
    if (!rule) throw new UnsupportedJurisdictionError(unsupported.reason, unsupported);
    return rule;
  }

  /**
   * A coverage report: what is modelled, how well, and what is missing.
   *
   * Drives the admin view and the "what does this product actually support"
   * section of the documentation, so neither can drift from the rule packs.
   */
  coverage() {
    const byCountry = new Map();
    for (const r of this.#rules) {
      const key = r.jurisdiction.country;
      if (!byCountry.has(key)) {
        byCountry.set(key, { country: key, regions: new Set(), categories: new Set(), rules: 0, verified: 0, estimated: 0, oldestReview: null });
      }
      const e = byCountry.get(key);
      e.rules++;
      if (r.jurisdiction.region) e.regions.add(r.jurisdiction.region);
      e.categories.add(r.category);
      if (r.verification === STATUS.VERIFIED) e.verified++;
      if (r.verification === STATUS.ESTIMATED) e.estimated++;
      if (e.oldestReview === null || r.lastReviewed < e.oldestReview) e.oldestReview = r.lastReviewed;
    }
    return {
      countries: [...byCountry.values()].map((e) => ({
        ...e,
        regions: [...e.regions].sort(),
        categories: [...e.categories].sort(),
      })).sort((a, b) => a.country.localeCompare(b.country)),
      declaredUnsupported: [...this.#declaredUnsupported],
      totalRules: this.#rules.length,
    };
  }

  /**
   * Rules whose last review is older than `days`.
   *
   * Tax rates move every year. A rule nobody has looked at in a year is a
   * liability whether or not it is still correct, so this is surfaced in the
   * admin area rather than left to memory.
   */
  staleRules(asOf, days = 365) {
    if (!ISO_DATE.test(asOf)) throw new TypeError('staleRules: asOf must be an ISO date');
    const cutoff = new Date(`${asOf}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return this.#rules
      .filter((r) => r.lastReviewed < cutoffIso)
      .map((r) => ({ id: r.id, lastReviewed: r.lastReviewed, jurisdiction: r.jurisdiction }));
  }

  /** Rules that have expired as at `on` — an effectiveTo in the past. */
  expiredRules(on) {
    if (!ISO_DATE.test(on)) throw new TypeError('expiredRules: on must be an ISO date');
    return this.#rules
      .filter((r) => r.effectiveTo != null && r.effectiveTo < on)
      .map((r) => ({ id: r.id, effectiveTo: r.effectiveTo }));
  }
}

/**
 * Within one component, the most specific rule wins: locality beats region
 * beats national, and a rule naming the property class, residency or holding
 * period beats one that does not. A genuine tie is a defect in the rule pack.
 */
function pickMostSpecific(group, q) {
  const ranked = group
    .map((r) => ({ r, score: specificity(r) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  const tied = ranked.filter((x) => x.score === top);
  if (tied.length > 1) {
    throw new AmbiguousRuleError(
      `RuleRegistry: ${tied.length} rules match ${q.country}/${q.category} on ${q.on} equally specifically `
      + `within component "${tied[0].r.component}" (${tied.map((x) => x.r.id).join(', ')}). `
      + 'Narrow their applicability so exactly one applies.',
      tied.map((x) => x.r.id),
    );
  }
  return ranked[0].r;
}

function describeFacts(facts) {
  const parts = [];
  if (facts.propertyClass) parts.push(`property class "${facts.propertyClass}"`);
  if (facts.ownership) parts.push(`ownership "${facts.ownership}"`);
  if (facts.residency) parts.push(`residency "${facts.residency}"`);
  return parts.length ? ` for ${parts.join(', ')}` : '';
}
