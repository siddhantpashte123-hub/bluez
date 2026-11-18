// Bounded, per-server public FAQ and ticket quick-reply templates.
const db = require('./db');
const MAX_ITEMS = 40;
function keyOf(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Use 1–32 letters, digits, hyphens or underscores for the key.');
  return key;
}
function list(store, guildId) { return db.guild(store, guildId).items ?? {}; }
function get(store, guildId, key) {
  const items = list(store, guildId); key = keyOf(key);
  return Object.hasOwn(items, key) ? items[key] : null;
}
function set(store, guildId, key, text) {
  key = keyOf(key); text = String(text ?? '').trim();
  if (!text || text.length > 1000) throw new Error('Text must be 1–1000 characters.');
  const items = list(store, guildId);
  if (!Object.hasOwn(items, key) && Object.keys(items).length >= MAX_ITEMS) throw new Error(`A server can save at most ${MAX_ITEMS} entries.`);
  db.updateGuild(store, guildId, s => { (s.items ??= {})[key] = text; });
}
function remove(store, guildId, key) {
  key = keyOf(key);
  if (!Object.hasOwn(list(store, guildId), key)) return false;
  db.updateGuild(store, guildId, s => { delete s.items[key]; });
  return true;
}
module.exports = { keyOf, list, get, set, remove };
