#!/usr/bin/env node
/**
 * check-rules.js — provenance and freshness gate for the rule packs.
 *
 * WHY THIS IS A BUILD STEP RATHER THAN A CONVENTION. Tax rates move every year.
 * A rule pack rots quietly: the numbers stay plausible, the citations stay
 * present, and nothing tells anyone that the figure was last checked eighteen
 * months ago against a page that has since changed. Checking it by memory does
 * not scale past the second jurisdiction.
 *
 * So the rules are asserted mechanically:
 *
 *   - every rule carries at least one citation, with an access date
 *   - anything claiming "verified" is backed by a citation marked primary
 *   - every rule declares what it does not cover
 *   - nothing is in force whose review date is older than the staleness budget
 *   - nothing has silently expired while still being served
 *
 * Exit code 1 fails CI. Run locally with `node tools/check-rules.js`.
 */

import { registry } from '../src/rules/index.js';
import { STATUS } from '../src/core/trace.js';

/** Days after which a rule must be re-checked against its source. */
const STALENESS_BUDGET_DAYS = 365;
/** Warn this far ahead of the budget so a refresh can be scheduled. */
const WARN_AHEAD_DAYS = 90;

const today = new Date().toISOString().slice(0, 10);
const errors = [];
const warnings = [];

const rules = registry.rules;
if (rules.length === 0) errors.push('The registry is empty — no rule packs were loaded.');

for (const rule of rules) {
  const where = `${rule.id}@${rule.version}`;

  if (!rule.citations || rule.citations.length === 0) {
    errors.push(`${where}: no citations.`);
  } else {
    for (const [i, c] of rule.citations.entries()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.accessed)) {
        errors.push(`${where}: citation ${i} has no access date.`);
      }
      if (c.accessed > today) {
        errors.push(`${where}: citation ${i} claims an access date in the future (${c.accessed}).`);
      }
    }
  }

  if (rule.verification === STATUS.VERIFIED && !rule.citations.some((c) => c.primary)) {
    errors.push(`${where}: claims "verified" without a primary citation.`);
  }

  if (!rule.limitations || rule.limitations.length === 0) {
    warnings.push(`${where}: declares no limitations. Every rule has an edge it does not cover.`);
  }

  if (rule.effectiveTo != null && rule.effectiveTo < rule.effectiveFrom) {
    errors.push(`${where}: effectiveTo precedes effectiveFrom.`);
  }
}

// --- staleness -------------------------------------------------------
const stale = registry.staleRules(today, STALENESS_BUDGET_DAYS);
for (const r of stale) {
  errors.push(`${r.id}: last reviewed ${r.lastReviewed}, older than the ${STALENESS_BUDGET_DAYS}-day budget. Re-check it against its source.`);
}

const approaching = registry
  .staleRules(today, STALENESS_BUDGET_DAYS - WARN_AHEAD_DAYS)
  .filter((r) => !stale.some((s) => s.id === r.id));
for (const r of approaching) {
  warnings.push(`${r.id}: last reviewed ${r.lastReviewed}, due for re-check within ${WARN_AHEAD_DAYS} days.`);
}

// --- expiry ----------------------------------------------------------
const expired = registry.expiredRules(today);
for (const r of expired) {
  warnings.push(`${r.id}: expired on ${r.effectiveTo}. It resolves to nothing for current dates, which is correct — but a replacement should be entered.`);
}

// --- report ----------------------------------------------------------
const coverage = registry.coverage();
console.log(`Rule packs: ${coverage.totalRules} rules across ${coverage.countries.length} countries.`);
for (const c of coverage.countries) {
  console.log(`  ${c.country}  ${String(c.rules).padStart(2)} rules  `
    + `(${c.verified} verified, ${c.estimated} estimated)  `
    + `regions: ${c.regions.length ? c.regions.join(', ') : 'national only'}`);
}
if (coverage.declaredUnsupported.length) {
  console.log(`  Declared gaps: ${coverage.declaredUnsupported.map((d) => d.region || d.country).join(', ')}`);
}

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log('\nRule hygiene OK.');
