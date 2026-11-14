/**
 * utils/db.js
 * ---------------------------------------------------------------
 * Tiny JSON-file "database". Every store is one file in /data:
 *   autoresponder | reacter | afk | invites | 247vc
 *
 * - Reads are cached in memory (fast, no disk hit per message).
 * - Writes are atomic (write temp file -> rename) so a crash or
 *   power loss can never leave a half-written JSON file behind.
 * ---------------------------------------------------------------
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const cache = new Map();

/** Absolute path of a store file, e.g. file('afk') -> /data/afk.json */
function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

/** Load a store (from cache, or from disk the first time). */
function get(name) {
  if (cache.has(name)) return cache.get(name);

  let data = {};
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(file(name))) {
      const raw = fs.readFileSync(file(name), 'utf8').trim();
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    }
  } catch (err) {
    // Corrupt file: keep a backup copy and start fresh instead of crashing.
    console.error(`[DB] Could not read ${name}.json (${err.message}). Starting with an empty store.`);
    try {
      fs.copyFileSync(file(name), `${file(name)}.corrupt-${Date.now()}`);
    } catch { /* nothing to back up */ }
  }

  cache.set(name, data);
  return data;
}

/** Persist a store to disk (atomic). */
function set(name, data) {
  cache.set(name, data);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${file(name)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file(name));
  } catch (err) {
    console.error(`[DB] Could not write ${name}.json:`, err.message);
  }
  return data;
}

/**
 * Load a store, let `mutator` change it, then save it.
 * Example: db.update('afk', (d) => { delete d[guildId][userId]; });
 */
function update(name, mutator) {
  const data = get(name);
  mutator(data);
  return set(name, data);
}

/** One guild's part of a store (read-only view, {} when nothing is saved). */
function guild(name, guildId) {
  return get(name)[guildId] ?? {};
}

/** Change one guild's part of a store and save. Returns that guild's data. */
function updateGuild(name, guildId, mutator) {
  return update(name, (data) => {
    mutator((data[guildId] ??= {}));
  })[guildId];
}

module.exports = { get, set, update, guild, updateGuild, DATA_DIR };
