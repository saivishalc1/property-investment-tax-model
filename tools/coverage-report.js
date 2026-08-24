#!/usr/bin/env node
/**
 * coverage-report.js — what is verified, tested, estimated or unsupported.
 *
 * WHY THIS IS GENERATED RATHER THAN WRITTEN. A coverage claim in a README is
 * true on the day it is typed and drifts from then on. This reads the rule
 * packs and the test files and reports what is actually there, so the claim
 * cannot outlive the code it describes.
 *
 * VERIFIED   the rule cites a primary source and says so
 * ESTIMATED  the rule exists but could not be confirmed from a primary source
 * TESTED     a test file names the rule id, so a change to it breaks a test
 * UNTESTED   the rule is in force and no test names it
 * UNSUPPORTED a jurisdiction or charge deliberately not modelled
 *
 * Run: node tools/coverage-report.js [--markdown]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/rules/index.js';
import { STATUS } from '../src/core/trace.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every rule id mentioned anywhere under tests/. */
function testedRuleIds() {
  const ids = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(test|spec)\.js$/.test(entry.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const rule of registry.rules) {
        // Match the id itself, or the exported constant a test imports it by.
        if (text.includes(rule.id)) ids.add(rule.id);
      }
    }
  };
  walk(path.join(root, 'tests'));
  return ids;
}

/**
 * Rules reached through an exported constant rather than a literal id.
 *
 * A test importing FEDERAL_1250_CAP exercises that rule without ever writing
 * its id, so a pure string scan under-reports coverage. The rule packs are
 * scanned for `export const NAME = ... id: '...'` to build the mapping.
 */
function constantToId() {
  const map = new Map();
  const dir = path.join(root, 'src', 'rules', 'jurisdictions');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    // Two shapes exist in the packs: a rule defined inline, and one built by a
    // small factory (federalOrdinary, nyState, ltcg2026 …) that takes the id as
    // its first argument. Matching only the inline form under-reported coverage
    // for every factory-built rule, which is most of the United States pack —
    // the report said seven rules were untested when tests for them existed.
    const inline = /export const ([A-Z0-9_]+)\s*=\s*defineRule\(\{\s*\n\s*id:\s*'([^']+)'/g;
    const factory = /export const ([A-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\(\s*'([a-z0-9][a-z0-9.-]*)'/g;
    for (const re of [inline, factory]) {
      let m;
      while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
    }
  }
  return map;
}

function testedViaConstants(map) {
  const ids = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(test|spec)\.js$/.test(entry.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const [name, id] of map) {
        if (new RegExp(`\\b${name}\\b`).test(text)) ids.add(id);
      }
    }
  };
  walk(path.join(root, 'tests'));
  return ids;
}

const byLiteral = testedRuleIds();
const byConstant = testedViaConstants(constantToId());
const tested = new Set([...byLiteral, ...byConstant]);

const today = new Date().toISOString().slice(0, 10);
const rules = [...registry.rules].sort((a, b) => a.id.localeCompare(b.id));
const coverage = registry.coverage();

const rows = rules.map((r) => ({
  id: r.id,
  country: r.jurisdiction.country,
  region: r.jurisdiction.region || '—',
  locality: r.jurisdiction.locality || '—',
  category: r.category,
  taxYear: r.taxYear,
  effective: `${r.effectiveFrom} → ${r.effectiveTo || 'open'}`,
  reviewed: r.lastReviewed,
  verification: r.verification,
  tested: tested.has(r.id),
  primarySource: r.citations.find((c) => c.primary)?.url
    || r.citations[0]?.url || '—',
  limitations: r.limitations.length,
}));

const totals = {
  rules: rows.length,
  verified: rows.filter((r) => r.verification === STATUS.VERIFIED).length,
  estimated: rows.filter((r) => r.verification === STATUS.ESTIMATED).length,
  tested: rows.filter((r) => r.tested).length,
  untested: rows.filter((r) => !r.tested).length,
  expired: registry.expiredRules(today).length,
  stale: registry.staleRules(today, 365).length,
};

const markdown = process.argv.includes('--markdown');

if (markdown) {
  const out = [];
  out.push('# Jurisdiction coverage');
  out.push('');
  out.push(`Generated ${today} from the rule packs and the test suite. Do not edit by hand.`);
  out.push('');
  out.push(`**${totals.rules} rules** — ${totals.verified} verified against a primary source, `
    + `${totals.estimated} estimated. **${totals.tested} covered by a test**, ${totals.untested} not.`);
  out.push('');

  for (const c of coverage.countries) {
    out.push(`## ${c.country}`);
    out.push('');
    out.push('| Rule | Category | Tax year | Effective | Verification | Tested | Source |');
    out.push('|---|---|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.country === c.country)) {
      out.push(`| \`${r.id}\` | ${r.category} | ${r.taxYear} | ${r.effective} | `
        + `${r.verification} | ${r.tested ? 'yes' : '**no**'} | `
        + `${r.primarySource === '—' ? '—' : `[source](${r.primarySource})`} |`);
    }
    out.push('');
  }

  out.push('## Deliberately not modelled');
  out.push('');
  for (const gap of coverage.declaredUnsupported) {
    out.push(`- **${gap.region || gap.country}**${gap.category ? ` (${gap.category})` : ''} — ${gap.reason}`);
  }
  out.push('');
  out.push('## Known limitations, by rule');
  out.push('');
  for (const rule of rules) {
    if (!rule.limitations.length) continue;
    out.push(`### \`${rule.id}\``);
    for (const l of rule.limitations) out.push(`- ${l}`);
    out.push('');
  }
  console.log(out.join('\n'));
} else {
  console.log(`Jurisdiction coverage — ${today}`);
  console.log('='.repeat(78));
  for (const c of coverage.countries) {
    const mine = rows.filter((x) => x.country === c.country);
    console.log(`\n${c.country}  ${mine.length} rules  `
      + `(${mine.filter((r) => r.verification === STATUS.VERIFIED).length} verified, `
      + `${mine.filter((r) => r.verification === STATUS.ESTIMATED).length} estimated, `
      + `${mine.filter((r) => r.tested).length} tested)`);
    for (const r of mine) {
      console.log(`  ${r.tested ? '✓' : '✗'} ${r.id.padEnd(46)} `
        + `${r.verification.padEnd(10)} ${r.taxYear}`);
    }
  }
  console.log(`\nDeliberately not modelled: ${coverage.declaredUnsupported.length}`);
  for (const g of coverage.declaredUnsupported) {
    console.log(`  - ${g.region || g.country}${g.category ? `/${g.category}` : ''}`);
  }
  console.log(`\nTotals: ${totals.rules} rules, ${totals.verified} verified, `
    + `${totals.estimated} estimated, ${totals.tested} tested, ${totals.untested} untested.`);
  if (totals.expired) console.log(`Expired rules still present: ${totals.expired}`);
  if (totals.stale) console.log(`Rules unreviewed for over a year: ${totals.stale}`);
}

// A rule in force that nothing tests is the gap this report exists to surface.
if (totals.untested > 0 && !markdown) {
  console.log(`\n${totals.untested} rule(s) have no test naming them.`);
}
