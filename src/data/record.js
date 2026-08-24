/**
 * record.js — the saved-property record: shape, validation, migration, search.
 *
 * Deliberately free of IndexedDB. Everything here is a pure function over plain
 * data, so the rules that decide whether a saved file is safe to open can be
 * unit tested in Node rather than only in a browser. store.js is the thin
 * database wrapper around it.
 *
 * THE THREAT MODEL FOR A LOCAL FILE. A saved analysis is JSON that leaves the
 * machine on export and comes back on import, possibly edited, possibly
 * corrupted, possibly hostile. Everything arriving from storage or a file is
 * treated as untrusted: keys that could reach Object.prototype are dropped,
 * depth and size are bounded, and a record that cannot be repaired is REPORTED
 * rather than silently replaced with defaults — losing a professional's work
 * quietly is worse than telling them a file is damaged.
 */

/** Bump when the record shape changes in a way that needs migration. */
export const RECORD_VERSION = 2;

/** Keys that must never survive a round trip through JSON. */
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_DEPTH = 12;
const MAX_STRING = 2000;
const MAX_ARRAY = 500;
/** A single record above this is not a property analysis; it is an attack or a bug. */
export const MAX_RECORD_BYTES = 512 * 1024;

/**
 * Strip anything that should not be in stored data.
 *
 * Mirrors storage.js's sanitiser, and exists separately because the two guard
 * different doors — one the autosave slot, one the property database and the
 * import file.
 */
export function sanitize(value, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (value === null) return null;

  const t = typeof value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'string') return value.slice(0, MAX_STRING);
  if (t !== 'object') return null; // functions, symbols, bigint

  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1));

  // Reject anything with an unusual prototype rather than walking it.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (BANNED_KEYS.has(k)) continue;
    const clean = sanitize(v, depth + 1);
    if (clean !== null || v === null) out[k] = clean;
  }
  return out;
}

const nowIso = () => new Date().toISOString();

/**
 * A stable, collision-resistant id.
 *
 * Random rather than time-based: an id that encodes when a property was created
 * leaks ordering into anything the id appears in, including an exported file
 * shared with someone else. Web Crypto is present in browsers and in Node 20+,
 * so there is no require() fallback to drag a Node built-in into browser code.
 */
export function newId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a record from a scenario and its computed summary.
 *
 * `summary` is deliberately a small set of headline figures, not the whole
 * result tree: the list view needs them to render without recomputing every
 * saved property, and storing the full results would make the database grow
 * without bound for numbers that are derived anyway.
 */
export function createRecord({ scenario, summary = {}, name, id } = {}) {
  const ts = nowIso();
  /*
   * What a property is called.
   *
   * The field the owner actually types into is labelled "Property address or
   * name" and is what the deal header and the report already use, so it is the
   * identity. scenario.meta.name is the SCENARIO's name and stays at its
   * default unless the report is titled — using it first made every saved
   * property read "New York City investment property".
   */
  const address = String(scenario?.purchase?.address || '').trim();
  const resolvedName = (name || address || scenario?.meta?.name || 'Untitled property');
  return {
    recordVersion: RECORD_VERSION,
    id: id || newId(),
    name: resolvedName.slice(0, 200),
    address: String(scenario?.purchase?.address || '').slice(0, 300),
    country: summary.country || null,
    jurisdiction: summary.jurisdiction || scenario?.meta?.preset || null,
    propertyType: scenario?.purchase?.propType || null,
    currency: summary.currency || null,
    taxYear: summary.taxYear || null,
    ruleStatus: summary.ruleStatus || null,
    summary: {
      price: summary.price ?? null,
      cashRequired: summary.cashRequired ?? null,
      noi: summary.noi ?? null,
      capRate: summary.capRate ?? null,
      cashOnCash: summary.cashOnCash ?? null,
      irr: summary.irr ?? null,
      totalProfit: summary.totalProfit ?? null,
    },
    scenario: sanitize(scenario) || {},
    archivedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Bring a stored record up to the current shape.
 *
 * Returns `{ record, repaired, problems }` rather than throwing. A record that
 * is damaged but recognisable is repaired and flagged; one that is not a record
 * at all returns `record: null` so the caller can quarantine it instead of
 * writing defaults over the user's work.
 */
export function migrateRecord(raw) {
  const problems = [];
  const clean = sanitize(raw);

  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
    return { record: null, repaired: false, problems: ['Not an object.'] };
  }
  if (!clean.scenario || typeof clean.scenario !== 'object') {
    return { record: null, repaired: false, problems: ['No scenario in the record.'] };
  }

  let repaired = false;
  const version = Number.isFinite(clean.recordVersion) ? clean.recordVersion : 1;

  const out = {
    recordVersion: RECORD_VERSION,
    id: typeof clean.id === 'string' && clean.id ? clean.id : newId(),
    name: typeof clean.name === 'string' && clean.name.trim()
      ? clean.name.slice(0, 200)
      : 'Untitled property',
    address: typeof clean.address === 'string' ? clean.address.slice(0, 300) : '',
    country: clean.country ?? null,
    jurisdiction: clean.jurisdiction ?? clean.scenario?.meta?.preset ?? null,
    propertyType: clean.propertyType ?? clean.scenario?.purchase?.propType ?? null,
    currency: clean.currency ?? null,
    taxYear: clean.taxYear ?? null,
    ruleStatus: clean.ruleStatus ?? null,
    summary: (clean.summary && typeof clean.summary === 'object') ? clean.summary : {},
    scenario: clean.scenario,
    archivedAt: typeof clean.archivedAt === 'string' ? clean.archivedAt : null,
    createdAt: isIsoDate(clean.createdAt) ? clean.createdAt : nowIso(),
    updatedAt: isIsoDate(clean.updatedAt) ? clean.updatedAt : nowIso(),
  };

  if (!clean.id) { problems.push('Missing id; a new one was generated.'); repaired = true; }
  if (!isIsoDate(clean.createdAt)) { problems.push('Missing or invalid creation time.'); repaired = true; }
  if (!isIsoDate(clean.updatedAt)) { problems.push('Missing or invalid modification time.'); repaired = true; }

  // v1 -> v2: the jurisdiction moved out of the scenario onto the record so the
  // list can group and filter without loading every scenario.
  if (version < 2) {
    if (!out.jurisdiction && clean.scenario?.meta?.preset) out.jurisdiction = clean.scenario.meta.preset;
    problems.push(`Upgraded from record version ${version}.`);
    repaired = true;
  }

  return { record: out, repaired, problems };
}

function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
}

/** Touch the modification time. Used on every save. */
export function touch(record) {
  return { ...record, updatedAt: nowIso() };
}

/**
 * Duplicate a record.
 *
 * A duplicate is a NEW property, so it gets a new id and its own creation time.
 * Carrying the original's timestamps across would make the copy sort as though
 * it were the original's age, which is confusing in a list ordered by recency.
 */
export function duplicateRecord(record, name) {
  const ts = nowIso();
  return {
    ...record,
    id: newId(),
    name: name || nextCopyName(record.name),
    archivedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** "Kings Road" -> "Kings Road (copy)" -> "Kings Road (copy 2)". */
export function nextCopyName(name) {
  const m = /^(.*) \(copy(?: (\d+))?\)$/.exec(name || '');
  if (!m) return `${name || 'Untitled property'} (copy)`;
  const n = m[2] ? Number(m[2]) + 1 : 2;
  return `${m[1]} (copy ${n})`;
}

/* ------------------------------------------------------------------ *
 * List behaviour
 * ------------------------------------------------------------------ */

export const SORT = Object.freeze({
  UPDATED: 'updated',
  CREATED: 'created',
  NAME: 'name',
  LOCATION: 'location',
  COUNTRY: 'country',
});

/**
 * Search across the fields a person actually remembers a property by.
 *
 * Matching is case- and accent-insensitive so "Kings Road" finds "Kings Röad",
 * and a multi-word query requires every word to appear somewhere — typing more
 * narrows rather than widens, which is what a search box is expected to do.
 */
export function matchesQuery(record, query) {
  const q = normalise(query);
  if (!q) return true;
  const haystack = normalise([
    record.name, record.address, record.jurisdiction, record.country, record.propertyType,
  ].filter(Boolean).join(' '));
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

function normalise(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function sortRecords(records, key = SORT.UPDATED, direction = 'desc') {
  const dir = direction === 'asc' ? 1 : -1;
  const byText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

  const sorted = [...records].sort((a, b) => {
    switch (key) {
      case SORT.NAME: return byText(a.name, b.name) * dir;
      case SORT.LOCATION: return byText(a.address, b.address) * dir;
      case SORT.COUNTRY: return byText(a.country || a.jurisdiction, b.country || b.jurisdiction) * dir;
      case SORT.CREATED: return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir;
      case SORT.UPDATED:
      default: return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir;
    }
  });
  return sorted;
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

export const EXPORT_KIND = 'property-investment-tax-model/backup';

/** A backup file: every record, with enough metadata to validate it on import. */
export function buildBackup(records) {
  return {
    kind: EXPORT_KIND,
    recordVersion: RECORD_VERSION,
    exportedAt: nowIso(),
    count: records.length,
    records,
  };
}

/**
 * Read a backup file.
 *
 * Every record is migrated individually, so one damaged property does not cost
 * the user the other forty. Returns what could be recovered alongside what
 * could not, and never throws on bad input.
 */
export function readBackup(raw) {
  const problems = [];
  let parsed = raw;

  if (typeof raw === 'string') {
    if (raw.length > MAX_RECORD_BYTES * 200) {
      return { records: [], rejected: [], problems: ['File is too large to be a backup.'] };
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { records: [], rejected: [], problems: ['Not valid JSON.'] };
    }
  }

  const clean = sanitize(parsed);
  if (!clean || typeof clean !== 'object') {
    return { records: [], rejected: [], problems: ['Not a backup file.'] };
  }
  if (clean.kind !== EXPORT_KIND) {
    return { records: [], rejected: [], problems: ['This file is not a backup from this application.'] };
  }
  if (!Array.isArray(clean.records)) {
    return { records: [], rejected: [], problems: ['The backup contains no records list.'] };
  }

  const records = [];
  const rejected = [];
  for (const [i, entry] of clean.records.entries()) {
    const { record, repaired, problems: p } = migrateRecord(entry);
    if (!record) {
      rejected.push({ index: i, name: entry?.name || null, problems: p });
      continue;
    }
    if (repaired) problems.push(`"${record.name}": ${p.join(' ')}`);
    records.push(record);
  }

  return { records, rejected, problems };
}
