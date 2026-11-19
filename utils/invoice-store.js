// Private per-server invoice records. Fail closed on corrupt or unwritable storage.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DATA_DIR } = require('./db');
const FILE = path.join(DATA_DIR, 'invoices.json');
function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid store');
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error('Invoice history is unavailable. Check bot storage.');
  }
}
function write(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, FILE); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
function get(guildId, id) { return read()[guildId]?.[id] ?? null; }
function list(guildId) { return Object.values(read()[guildId] ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function create(guildId, record) {
  const data = read(), group = (data[guildId] ??= {});
  if (Object.hasOwn(group, record.id)) throw new Error('Invoice ID already exists.');
  group[record.id] = record; write(data);
}
function update(guildId, id, fields) {
  const data = read(), record = data[guildId]?.[id];
  if (!record) return null;
  Object.assign(record, fields); write(data); return record;
}
module.exports = { get, list, create, update };
