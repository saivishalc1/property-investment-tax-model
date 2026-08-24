/**
 * index.js — the assembled rule registry.
 *
 * One place that knows every jurisdiction the product supports, and every
 * jurisdiction it knowingly does not. Import this rather than reaching into a
 * pack directly, so nothing can bypass the resolution rules.
 */

import { RuleRegistry } from './registry.js';
import { UK_RULES, UNSUPPORTED_REGIONS as UK_UNSUPPORTED } from './jurisdictions/uk.js';
import { JP_RULES } from './jurisdictions/jp.js';

export const registry = new RuleRegistry()
  .add(UK_RULES)
  .add(JP_RULES);

for (const region of UK_UNSUPPORTED) {
  registry.declareUnsupported({
    country: 'GB',
    region: region.region,
    reason: region.reason,
    authority: region.authority,
    url: region.url,
  });
}

export { RuleRegistry, UnsupportedJurisdictionError, AmbiguousRuleError } from './registry.js';
export * from './schema.js';
export { evaluateRule, marginalCharge, unsupported } from './evaluate.js';
