/**
 * storage.js — scenario schema, defaults, versioned local persistence,
 * migration, and hardened import of untrusted JSON.
 *
 * Nothing here ever leaves the browser. There is no network call in this file
 * and none anywhere else in the application.
 */

import { PRESETS } from './presets.js';

export const SCHEMA_VERSION = 3;
const NS = 'pitm';
const KEY_AUTOSAVE = `${NS}.autosave.v${SCHEMA_VERSION}`;
const KEY_SCENARIOS = `${NS}.scenarios.v${SCHEMA_VERSION}`;
const KEY_PREFS = `${NS}.prefs.v1`;
const LEGACY_KEYS = ['pitm.autosave.v1', 'pitm.autosave.v2', 'retax.state', 'propertyTaxModel'];

/* ------------------------------------------------------------------ *
 * Default scenario
 * ------------------------------------------------------------------ */

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: newId(),
      name: 'Untitled scenario',
      preset: 'us-nyc',
      mode: 'quick',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    profile: {
      filingStatus: 'single',
      otherMAGI: 150000,
      nycResident: true,
      usTaxResident: true,
      fullDisposition: true,
      ownerType: 'individual',
      serviceMonth: 1,
      capexYear: 1,
      capexMonth: 7,
      niitOnRental: true,
    },
    purchase: {
      price: 950000,
      propType: 'residential',
      landPct: 20,
      downPct: 30,
      loanRate: 6.75,
      loanTermYrs: 30,
      ioYears: 0,
      pointsPct: 1,
      titlePct: 0.45,
      legal: 4000,
      inspection: 1500,
      otherBuy: 2500,
      transferTaxPayer: 'seller',
    },
    hold: {
      years: 7,
      rentMo: 7000,
      otherIncomeYr: 0,
      vacancyPct: 5,
      rentGrowthPct: 3,
      propTaxYr: 10000,
      insuranceYr: 2400,
      hoaMo: 500,
      utilitiesYr: 0,
      otherOpexYr: 1000,
      maintPct: 5,
      mgmtPct: 6,
      opexGrowthPct: 3,
      capexTotal: 25000,
      capexTiming: 'lump',
      apprPct: 3.5,
      passiveAllowed: false,
    },
    sale: {
      useOverride: false,
      overridePrice: 0,
      saleMonth: 12,
      brokerPct: 5,
      sellLegal: 4000,
      transferTaxPayer: 'seller',
      flipTaxPct: 2,
      otherSell: 2000,
    },
    rates: structuredClone(PRESETS['us-nyc'].rates),
  };
}

/** The NYC worked example offered on the welcome screen. */
export function nycExampleState() {
  const s = defaultState();
  s.meta.name = 'NYC example — 2-bed condo, Upper East Side';
  s.purchase.price = 1250000;
  s.hold.rentMo = 7600;
  s.hold.propTaxYr = 13200;
  s.hold.hoaMo = 1150;
  s.hold.years = 10;
  s.profile.otherMAGI = 320000;
  return s;
}

export function newId() {
  const a = new Uint8Array(8);
  (globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ *
 * Sanitisation — untrusted JSON never reaches the model unfiltered
 * ------------------------------------------------------------------ */

const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively rebuild a value from plain primitives only.
 *
 * This is the security boundary for imported scenario files. It:
 *   - drops __proto__ / constructor / prototype keys, blocking prototype
 *     pollution via JSON.parse output;
 *   - drops functions, symbols, class instances, Dates and anything else that
 *     is not a plain object, array, string, finite number or boolean;
 *   - truncates strings, so an imported name cannot be a megabyte of markup;
 *   - bounds depth and array length, so a hand-built file cannot exhaust the
 *     stack or the heap.
 *
 * Strings are NOT trusted after this step either — the UI writes every
 * user-controlled string with textContent, never innerHTML.
 */
export function sanitize(value, depth = 0) {
  if (depth > 12) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value) ? value : 0;
  if (t === 'boolean') return value;
  if (t === 'string') return value.slice(0, 2000);
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((v) => sanitize(v, depth + 1));
  }
  if (t === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
    const out = Object.create(null);
    let n = 0;
    for (const k of Object.keys(value)) {
      if (BANNED_KEYS.has(k)) continue;
      const v = value[k];
      // Functions, symbols and undefined have no JSON representation and no
      // place in a scenario file: drop the key rather than storing a null.
      const t = typeof v;
      if (t === 'function' || t === 'symbol' || t === 'undefined') continue;
      if (++n > 200) break;
      out[k] = sanitize(v, depth + 1);
    }
    return Object.assign({}, out);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/**
 * Bring any older scenario shape up to the current schema.
 *
 * v1 → v2  `hold.depMonthsY1` replaced by `profile.serviceMonth`.
 * v2 → v3  boolean `buyerPaysTransferTax` / `sellerPaysTransferTax` replaced by
 *          an explicit `transferTaxPayer` on each side, so the two can never
 *          contradict each other; `profile.capexMonth`, `hold.capexTiming`,
 *          `sale.saleMonth` and `profile.niitOnRental` added.
 */
export function migrate(raw) {
  const s = sanitize(raw);
  if (!s || typeof s !== 'object') return null;

  const version = Number.isFinite(s.schemaVersion) ? s.schemaVersion : 1;
  const base = defaultState();
  const out = base;

  // Section-wise merge: unknown keys are dropped, missing keys keep defaults.
  for (const section of ['meta', 'profile', 'purchase', 'hold', 'sale']) {
    if (s[section] && typeof s[section] === 'object') {
      for (const k of Object.keys(base[section])) {
        if (k in s[section] && s[section][k] !== null) out[section][k] = s[section][k];
      }
    }
  }

  if (s.rates && typeof s.rates === 'object') {
    const rateTemplate = structuredClone(PRESETS['us-nyc'].rates);
    for (const k of Object.keys(rateTemplate)) {
      if (k in s.rates && s.rates[k] !== null) out.rates[k] = s.rates[k];
    }
  }

  if (version < 2) {
    const legacy = s.hold && s.hold.depMonthsY1;
    if (Number.isFinite(legacy) && legacy > 0 && legacy <= 12) {
      out.profile.serviceMonth = Math.max(1, 13 - Math.round(legacy));
    }
  }

  if (version < 3) {
    const p = s.purchase || {};
    const sa = s.sale || {};
    out.purchase.transferTaxPayer = p.buyerPaysTransferTax ? 'buyer' : 'seller';
    out.sale.transferTaxPayer = sa.sellerPaysTransferTax === false ? 'buyer' : 'seller';
    out.hold.capexTiming = 'spread'; // v1/v2 spread improvement spend evenly
  }

  // Bracket tables must be arrays of {min, rate} numbers or the engine is fed
  // strings and silently produces NaN.
  for (const key of ['stateTransferRes', 'stateTransferComm', 'cityTransferRes',
    'cityTransferComm', 'mansion', 'mrtResidential', 'cgtByYears', 'sellerDutyByYears']) {
    out.rates[key] = normaliseTable(out.rates[key]);
  }

  if (!out.meta.id) out.meta.id = newId();
  if (!PRESETS[out.meta.preset]) out.meta.preset = 'us-nyc';
  if (out.meta.mode !== 'pro') out.meta.mode = 'quick';
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

export function normaliseTable(t) {
  if (!Array.isArray(t)) return [];
  return t
    .filter((b) => b && typeof b === 'object')
    .map((b) => ({ min: toNum(b.min), rate: toNum(b.rate) }))
    .sort((a, b) => a.min - b.min);
}

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function safeGet(key) {
  try { return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null; }
  catch { return null; }
}
function safeSet(key, value) {
  try { globalThis.localStorage && globalThis.localStorage.setItem(key, value); return true; }
  catch { return false; }
}
function safeRemove(key) {
  try { globalThis.localStorage && globalThis.localStorage.removeItem(key); } catch { /* ignore */ }
}

export function saveAutosave(state) {
  return safeSet(KEY_AUTOSAVE, JSON.stringify(state));
}

export function loadAutosave() {
  let raw = safeGet(KEY_AUTOSAVE);
  if (!raw) {
    for (const k of LEGACY_KEYS) {
      const legacy = safeGet(k);
      if (legacy) { raw = legacy; break; }
    }
  }
  if (!raw) return null;
  try { return migrate(JSON.parse(raw)); } catch { return null; }
}

export function clearAutosave() { safeRemove(KEY_AUTOSAVE); }

export function listScenarios() {
  const raw = safeGet(KEY_SCENARIOS);
  if (!raw) return [];
  try {
    const parsed = sanitize(JSON.parse(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrate).filter(Boolean);
  } catch { return []; }
}

export function saveScenario(state) {
  const all = listScenarios();
  const copy = structuredClone(state);
  copy.meta.updated = new Date().toISOString();
  const i = all.findIndex((s) => s.meta.id === copy.meta.id);
  if (i >= 0) all[i] = copy; else all.push(copy);
  const ok = safeSet(KEY_SCENARIOS, JSON.stringify(all.slice(-50)));
  return ok ? copy : null;
}

export function deleteScenario(id) {
  const all = listScenarios().filter((s) => s.meta.id !== id);
  safeSet(KEY_SCENARIOS, JSON.stringify(all));
  return all;
}

export function duplicateScenario(state) {
  const copy = structuredClone(state);
  copy.meta.id = newId();
  copy.meta.name = `${copy.meta.name} (copy)`;
  copy.meta.created = new Date().toISOString();
  return copy;
}

export function loadPrefs() {
  try { return sanitize(JSON.parse(safeGet(KEY_PREFS) || '{}')) || {}; }
  catch { return {}; }
}

export function savePrefs(prefs) {
  return safeSet(KEY_PREFS, JSON.stringify(prefs || {}));
}

export const _keys = { KEY_AUTOSAVE, KEY_SCENARIOS, KEY_PREFS };
