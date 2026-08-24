/**
 * store.js — the saved-property database.
 *
 * IndexedDB rather than localStorage. localStorage is a synchronous string map
 * with a few megabytes of room and no indexes: it blocks the main thread on
 * every write, and finding "every Japanese property updated this month" means
 * parsing every record. A professional with a hundred analyses would feel both.
 * IndexedDB gives real indexes, far more room, and asynchronous writes.
 *
 * The autosave slot in storage.js stays where it is. That is a single
 * in-progress scratch value and localStorage is exactly right for it; this is
 * the library of finished work.
 *
 * All record shape, validation, migration and search logic lives in record.js
 * so it can be tested without a browser. This file is the database and nothing
 * else.
 */

import {
  RECORD_VERSION, migrateRecord, touch, buildBackup, readBackup,
  matchesQuery, sortRecords, SORT,
} from './record.js';

const DB_NAME = 'pitm-properties';
/** Bump only for an IndexedDB schema change (stores/indexes), not a record change. */
const DB_VERSION = 1;
const STORE = 'properties';
/** Records that could not be migrated are kept here rather than discarded. */
const QUARANTINE = 'quarantine';

let dbPromise = null;

/** True when this browser can store analyses at all. */
export function isSupported() {
  return typeof indexedDB !== 'undefined';
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isSupported()) { reject(new Error('IndexedDB is not available in this browser.')); return; }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        // Indexed because the workspace sorts and filters on them.
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('name', 'name');
        s.createIndex('jurisdiction', 'jurisdiction');
        s.createIndex('archivedAt', 'archivedAt');
      }
      if (!db.objectStoreNames.contains(QUARANTINE)) {
        db.createObjectStore(QUARANTINE, { keyPath: 'id', autoIncrement: true });
      }
      void event;
    };

    req.onsuccess = () => {
      const db = req.result;
      // A second tab upgrading the schema must not leave this one on a stale
      // connection holding the upgrade open.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the property database.'));
    req.onblocked = () => reject(new Error('Another tab is holding the database open. Close it and retry.'));
  });
  return dbPromise;
}

function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The database transaction was aborted.'));
    result = fn(t);
  });
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Every record, migrated on the way out.
 *
 * A record that cannot be migrated is moved to quarantine rather than returned
 * or deleted, so a damaged file never breaks the list and never disappears
 * without the owner being able to look at it.
 */
export async function listAll({ includeArchived = false } = {}) {
  const db = await open();
  const raw = await tx(db, [STORE], 'readonly', (t) => {
    const out = [];
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      out.push(cursor.value);
      cursor.continue();
    };
    return out;
  });

  const records = [];
  const damaged = [];
  for (const entry of raw) {
    const { record, repaired, problems } = migrateRecord(entry);
    if (!record) { damaged.push({ entry, problems }); continue; }
    if (repaired) {
      // Persist the repair so it happens once rather than on every load.
      await put(record).catch(() => {});
    }
    records.push(record);
  }

  if (damaged.length) await quarantine(damaged);

  return {
    records: includeArchived ? records : records.filter((r) => !r.archivedAt),
    damaged: damaged.length,
  };
}

/** The workspace list: filtered, sorted, ready to render. */
export async function query({ search = '', sort = SORT.UPDATED, direction = 'desc', includeArchived = false } = {}) {
  const { records, damaged } = await listAll({ includeArchived });
  const filtered = records.filter((r) => matchesQuery(r, search));
  return { records: sortRecords(filtered, sort, direction), total: records.length, damaged };
}

export async function get(id) {
  const db = await open();
  const raw = await tx(db, [STORE], 'readonly', (t) => request(t.objectStore(STORE).get(id)));
  if (!raw) return null;
  const { record } = migrateRecord(raw);
  return record;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export async function put(record) {
  const db = await open();
  const stamped = { ...record, recordVersion: RECORD_VERSION };
  await tx(db, [STORE], 'readwrite', (t) => t.objectStore(STORE).put(stamped));
  return stamped;
}

/** Save, updating the modification time. The workspace's normal save path. */
export async function save(record) {
  return put(touch(record));
}

export async function rename(id, name) {
  const record = await get(id);
  if (!record) throw new Error('That property is no longer saved.');
  return save({ ...record, name: String(name || '').slice(0, 200) || 'Untitled property' });
}

/**
 * Archive rather than delete.
 *
 * Archiving is reversible and delete is not, so the workspace offers archive
 * first. Deletion still exists — a professional is entitled to remove a client's
 * data properly — but it is a separate, confirmed action.
 */
export async function archive(id) {
  const record = await get(id);
  if (!record) throw new Error('That property is no longer saved.');
  return put({ ...record, archivedAt: new Date().toISOString() });
}

export async function unarchive(id) {
  const record = await get(id);
  if (!record) throw new Error('That property is no longer saved.');
  return put({ ...record, archivedAt: null });
}

export async function remove(id) {
  const db = await open();
  await tx(db, [STORE], 'readwrite', (t) => t.objectStore(STORE).delete(id));
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

/** Everything, archived included — a backup that omits records is not a backup. */
export async function exportBackup() {
  const { records } = await listAll({ includeArchived: true });
  return buildBackup(records);
}

/**
 * Import a backup.
 *
 * `mode: 'merge'` keeps existing properties and adds or updates by id, which is
 * what restoring onto a working machine should do. `mode: 'replace'` clears
 * first, for restoring onto an empty one. Merge is the default because it
 * cannot destroy work.
 */
export async function importBackup(fileContents, { mode = 'merge' } = {}) {
  const { records, rejected, problems } = readBackup(fileContents);
  if (!records.length) return { imported: 0, rejected, problems };

  const db = await open();
  await tx(db, [STORE], 'readwrite', (t) => {
    const store = t.objectStore(STORE);
    if (mode === 'replace') store.clear();
    for (const r of records) store.put({ ...r, recordVersion: RECORD_VERSION });
  });

  return { imported: records.length, rejected, problems };
}

async function quarantine(damaged) {
  try {
    const db = await open();
    await tx(db, [QUARANTINE], 'readwrite', (t) => {
      const store = t.objectStore(QUARANTINE);
      for (const d of damaged) {
        store.put({ at: new Date().toISOString(), problems: d.problems, entry: d.entry });
      }
    });
  } catch {
    // Quarantine is a courtesy. Failing to record a damaged row must never
    // stop the workspace from opening.
  }
}

/** Damaged records held back from the list, for the owner to inspect. */
export async function listQuarantine() {
  const db = await open();
  return tx(db, [QUARANTINE], 'readonly', (t) => {
    const out = [];
    const req = t.objectStore(QUARANTINE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      out.push(cursor.value);
      cursor.continue();
    };
    return out;
  });
}

export async function clearQuarantine() {
  const db = await open();
  await tx(db, [QUARANTINE], 'readwrite', (t) => t.objectStore(QUARANTINE).clear());
}

/** For tests and for "start over": remove everything this app stored. */
export async function wipe() {
  const db = await open();
  await tx(db, [STORE, QUARANTINE], 'readwrite', (t) => {
    t.objectStore(STORE).clear();
    t.objectStore(QUARANTINE).clear();
  });
}

export { SORT } from './record.js';
