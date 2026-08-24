/**
 * workspace.js — the saved property library.
 *
 * The first screen. Opening straight into a blank calculator assumes every
 * visit begins a new analysis, when for a professional revisiting a portfolio
 * most visits begin by returning to one. This is the list, the search, and the
 * actions on a saved property; the analysis itself stays in app.js.
 *
 * Nothing here computes tax. It reads and writes records and asks app.js to
 * open one.
 */

import * as store from './data/store.js';
import {
  createRecord, duplicateRecord, buildBackup, SORT,
} from './data/record.js';
import { jurisdictionFor } from './engine/jurisdiction.js';
import { Money, formatMoney } from './core/money.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.appendChild(kid);
  return node;
};

let hooks = { onOpen: () => {}, onNew: () => {}, onExample: () => {} };
let state = { search: '', sort: SORT.UPDATED, includeArchived: false };

/** Wire the workspace up. `onOpen(record)` and `onNew()` are app.js callbacks. */
export function initWorkspace(callbacks) {
  hooks = { ...hooks, ...callbacks };

  $('#wsNew')?.addEventListener('click', () => hooks.onNew());
  $('#wsExample')?.addEventListener('click', () => hooks.onExample());
  $('#wsSearch')?.addEventListener('input', (e) => { state.search = e.target.value; refresh(); });
  $('#wsSort')?.addEventListener('change', (e) => { state.sort = e.target.value; refresh(); });
  $('#wsArchived')?.addEventListener('change', (e) => { state.includeArchived = e.target.checked; refresh(); });
  $('#wsExport')?.addEventListener('click', exportBackup);
  $('#wsImportBtn')?.addEventListener('click', () => $('#wsImport')?.click());
  $('#wsImport')?.addEventListener('change', importBackup);

  return refresh();
}

/*
 * The analysis view is a three-column grid — steps, main, summary rail — so
 * hiding the columns individually leaves the rail floating on an empty page.
 * The whole shell is toggled instead.
 */
export function showWorkspace() {
  $('#workspace').hidden = false;
  $('#dealStrip').hidden = true;
  $('#libraryBtn').hidden = true;
  $('#saveStatus').hidden = true;
  document.querySelector('.shell')?.setAttribute('hidden', '');
  // The skip link must point at the region that is actually on screen. Left
  // pointing at #main it skipped a keyboard user into hidden content, which is
  // worse than having no skip link at all.
  $('#skipLink')?.setAttribute('href', '#workspace');
  // Controls that only mean something inside an analysis. The detail level and
  // "Start over" have no referent while looking at a list of properties, and
  // the brand subtitle still named whichever market was last open.
  document.querySelector('.segmented')?.setAttribute('hidden', '');
  $('#resetBtn')?.setAttribute('hidden', '');
  const sub = $('#brandScenario');
  if (sub) sub.textContent = '';
  // Returning to the library from halfway down an analysis must not land the
  // owner halfway down the library.
  window.scrollTo({ top: 0, behavior: 'auto' });
  return refresh();
}

export function showAnalysis() {
  $('#workspace').hidden = true;
  $('#dealStrip').hidden = false;
  $('#libraryBtn').hidden = false;
  $('#saveStatus').hidden = false;
  document.querySelector('.shell')?.removeAttribute('hidden');
  $('#skipLink')?.setAttribute('href', '#main');
  document.querySelector('.segmented')?.removeAttribute('hidden');
  $('#resetBtn')?.removeAttribute('hidden');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

export async function refresh() {
  const list = $('#wsList');
  if (!list) return;

  let result;
  try {
    result = await store.query(state);
  } catch (err) {
    // A browser with IndexedDB blocked (private mode in some browsers, or a
    // policy) must say so rather than showing an empty library that looks like
    // lost work.
    notice('warn', 'Saved properties are unavailable in this browser. '
      + `Your analyses cannot be stored here. (${err.message})`);
    list.replaceChildren();
    $('#wsEmpty').hidden = false;
    return;
  }

  const { records, total, damaged } = result;
  list.replaceChildren();

  $('#workspaceCount').textContent = total === 0
    ? 'No saved analyses yet.'
    : `${total} saved ${total === 1 ? 'analysis' : 'analyses'}`
      + (records.length !== total ? ` — ${records.length} shown` : '');

  if (damaged) {
    notice('warn', `${damaged} saved ${damaged === 1 ? 'record was' : 'records were'} damaged and could not be opened. `
      + 'They have been set aside rather than deleted.');
  }

  $('#wsEmpty').hidden = records.length > 0;
  for (const record of records) list.appendChild(row(record));
}

function row(record) {
  const j = jurisdictionFor(record.jurisdiction);
  const item = el('li', { class: `property-row${record.archivedAt ? ' is-archived' : ''}` });

  const open = el('button', {
    type: 'button', class: 'property-open',
    'aria-label': `Open ${record.name}`,
  });
  open.appendChild(el('span', { class: 'property-name', text: record.name }));
  // The name defaults to the address, so repeating it under the name is noise.
  // Only show the address when the owner has renamed the property and the two
  // now say different things.
  const meta = [
    record.address && record.address !== record.name ? record.address : null,
    j.label || record.jurisdiction,
  ].filter(Boolean).join(' · ');
  open.appendChild(el('span', { class: 'property-meta', text: meta || '—' }));
  open.addEventListener('click', () => hooks.onOpen(record));
  item.appendChild(open);

  item.appendChild(el('span', { class: 'property-figure', text: headline(record) }));
  item.appendChild(el('span', {
    class: 'property-updated',
    text: relativeTime(record.updatedAt),
    title: new Date(record.updatedAt).toLocaleString(),
  }));

  item.appendChild(actions(record));
  return item;
}

/**
 * The one number worth showing in a list.
 *
 * The purchase price, in the property's own currency — the figure a person
 * uses to recognise a deal. A rate of return would need every saved scenario
 * recomputed to be trustworthy, and a stale one is worse than none.
 */
function headline(record) {
  const { price } = record.summary || {};
  if (price == null || !record.currency) return '—';
  try {
    return formatMoney(Money.of(String(Math.round(price)), record.currency), { compact: true });
  } catch {
    return '—';
  }
}

function actions(record) {
  const wrap = el('div', { class: 'property-actions' });

  wrap.appendChild(button('Rename', async () => {
    const name = prompt('Rename this property', record.name);
    if (name == null) return;
    await store.rename(record.id, name.trim() || record.name);
    await refresh();
  }));

  wrap.appendChild(button('Duplicate', async () => {
    await store.put(duplicateRecord(record));
    await refresh();
  }));

  if (record.archivedAt) {
    wrap.appendChild(button('Restore', async () => {
      await store.unarchive(record.id);
      await refresh();
    }));
  } else {
    wrap.appendChild(button('Archive', async () => {
      await store.archive(record.id);
      await refresh();
    }));
  }

  // Deletion is irreversible, so it is confirmed and names what is being lost.
  wrap.appendChild(button('Delete', async () => {
    const ok = confirm(
      `Delete "${record.name}" permanently?\n\n`
      + 'This cannot be undone. Archiving keeps it out of the list but recoverable.',
    );
    if (!ok) return;
    await store.remove(record.id);
    await refresh();
  }, 'danger'));

  return wrap;
}

function button(label, onClick, variant) {
  const b = el('button', { type: 'button', class: `btn btn-sm${variant ? ` btn-${variant}` : ''}`, text: label });
  b.addEventListener('click', onClick);
  return b;
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

async function exportBackup() {
  try {
    const backup = await store.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: `property-analyses-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notice('ok', `Exported ${backup.count} ${backup.count === 1 ? 'property' : 'properties'}.`);
  } catch (err) {
    notice('error', `Export failed: ${err.message}`);
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // so the same file can be chosen twice
  if (!file) return;

  try {
    const text = await file.text();
    const { imported, rejected, problems } = await store.importBackup(text, { mode: 'merge' });

    if (!imported && !rejected.length) {
      notice('error', problems[0] || 'Nothing in that file could be read.');
      return;
    }
    const parts = [`Imported ${imported} ${imported === 1 ? 'property' : 'properties'}.`];
    if (rejected.length) parts.push(`${rejected.length} could not be read and ${rejected.length === 1 ? 'was' : 'were'} skipped.`);
    if (problems.length) parts.push(`${problems.length} needed repair.`);
    notice(rejected.length ? 'warn' : 'ok', parts.join(' '));
    await refresh();
  } catch (err) {
    notice('error', `Import failed: ${err.message}`);
  }
}

function notice(kind, message) {
  const box = $('#wsNotice');
  if (!box) return;
  box.className = `callout ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : 'warn'}`;
  box.textContent = message;
  box.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Saving from the analysis view
 * ------------------------------------------------------------------ */

let saveTimer = null;
let currentId = null;

/**
 * Which record the analysis view is editing.
 *
 * `null` starts a new one on the next save. app.js sets this when a property is
 * opened from the library and clears it when a new analysis begins, so autosave
 * knows whether to update an existing record or create one.
 */
export function setCurrentRecord(id) { currentId = id; }

/**
 * Autosave, debounced.
 *
 * Every keystroke writing to IndexedDB would be wasteful and would make the
 * modification time meaningless. A pause of a second is long enough to batch a
 * burst of typing and short enough that closing the tab loses nothing a person
 * would notice.
 */
export function scheduleSave(scenario, summary) {
  status('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveNow(scenario, summary); }, 1000);
}

export async function saveNow(scenario, summary) {
  try {
    let record;
    if (currentId) {
      const existing = await store.get(currentId);
      // A rename is the owner's explicit choice and must survive every later
      // autosave, so the existing name is passed back in rather than being
      // re-derived from the address on each keystroke.
      record = existing
        ? {
          ...createRecord({ scenario, summary, id: currentId, name: existing.name }),
          createdAt: existing.createdAt,
          archivedAt: existing.archivedAt,
        }
        : createRecord({ scenario, summary, id: currentId });
    } else {
      record = createRecord({ scenario, summary });
      currentId = record.id;
    }
    const saved = await store.save(record);
    status('saved', saved.updatedAt);
    return saved;
  } catch (err) {
    status('error');
    return null;
  }
}

function status(kind, at) {
  const node = $('#saveStatus');
  if (!node) return;
  node.dataset.state = kind;
  node.textContent = kind === 'saving' ? 'Saving…'
    : kind === 'saved' ? `Saved ${relativeTime(at)}`
      : 'Not saved — this browser is blocking local storage';
}

/* ------------------------------------------------------------------ */

function relativeTime(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (seconds >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return 'just now';
}
