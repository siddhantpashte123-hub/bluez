// Private per-user, per-server payment settings. Read/write failures must not be reported as success.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DATA_DIR } = require('./db');
const FILE = path.join(DATA_DIR, 'upi-settings.json');

function validId(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 50 && /^[\w.-]+@[\w.-]+$/.test(value);
}
function read() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid UPI settings store');
    return value;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error('Saved UPI settings are unavailable. Check bot storage.');
  }
}
function get(guildId, userId) {
  const settings = read()[guildId]?.[userId];
  if (!settings) return null;
  if (!validId(settings.upiId) || typeof settings.name !== 'string' || settings.name.length > 60) throw new Error('Saved UPI settings are invalid. Set them again.');
  return settings;
}
function write(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = `${FILE}.${randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, FILE); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function save(guildId, userId, upiId, name = '') {
  if (!validId(upiId)) throw new Error('Invalid UPI ID. Use a format like name@bank.');
  if (typeof name !== 'string' || name.length > 60) throw new Error('Invalid payee name.');
  const data = read();
  (data[guildId] ??= {})[userId] = { upiId, name };
  write(data);
}
function clear(guildId, userId) {
  const data = read();
  if (!Object.hasOwn(data[guildId] ?? {}, userId)) return false;
  delete data[guildId][userId];
  if (Object.keys(data[guildId]).length === 0) delete data[guildId];
  write(data);
  return true;
}
module.exports = { validId, get, save, clear };
