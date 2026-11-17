// Code-based channel skeletons. Codes are random bearer secrets; only their hashes are stored.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { DATA_DIR } = require('./db');
const TYPES = new Set([ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia]);
const FILE = path.join(DATA_DIR, 'channel-backups.json');
const hash = (code) => createHash('sha256').update(code).digest('hex');

function plan(guild, fetched) {
  const channels = [...fetched.values()].filter(Boolean);
  if (!channels.length || channels.length > 500) throw new Error('A backup must contain 1–500 channels.');
  if (channels.some((c) => !TYPES.has(c.type))) throw new Error('This server has an unsupported channel type. No backup was created.');
  const list = channels.map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null, position: c.rawPosition ?? 0 }));
  const snapshot = { version: 1, sourceId: guild.id, sourceName: guild.name, channels: list };
  validate(snapshot);
  return snapshot;
}
function validate(snapshot) {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.sourceId !== 'string' || !Array.isArray(snapshot.channels) || !snapshot.channels.length || snapshot.channels.length > 500) throw new Error('Invalid or empty backup.');
  const ids = new Set();
  for (const c of snapshot.channels) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100 || !TYPES.has(c.type) || !Number.isInteger(c.position) || (c.parentId !== null && typeof c.parentId !== 'string')) throw new Error('Invalid channel in backup.');
    ids.add(c.id);
  }
  const categories = new Set(snapshot.channels.filter(c => c.type === ChannelType.GuildCategory).map(c => c.id));
  if (snapshot.channels.some(c => (c.type === ChannelType.GuildCategory && c.parentId) || (c.parentId && !categories.has(c.parentId)))) throw new Error('Invalid category structure in backup.');
  return snapshot;
}
function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup store');
    return data;
  } catch (err) { if (err.code === 'ENOENT') return {}; throw new Error('Backup store could not be read; check VPS storage.'); }
}
function save(snapshot) {
  validate(snapshot);
  const code = randomBytes(32).toString('base64url');
  const data = read(); data[hash(code)] = snapshot;
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, FILE); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
  return code;
}
function load(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Invalid backup code.');
  const snapshot = read()[hash(code)];
  if (!snapshot) throw new Error('Invalid backup code.');
  return validate(snapshot);
}
function checkTarget(guild, snapshot, channels) {
  validate(snapshot);
  if (guild.id === snapshot.sourceId) throw new Error('Use a different server from the backup source.');
  if (snapshot.channels.some(c => c.type === ChannelType.GuildAnnouncement) && !guild.features.includes('COMMUNITY')) throw new Error('The target server needs Community enabled for announcement channels.');
  if (snapshot.channels.some(c => c.type === ChannelType.GuildForum) && !guild.features.includes('COMMUNITY')) throw new Error('The target server needs Community enabled for forum channels.');
  if (snapshot.channels.some(c => c.type === ChannelType.GuildMedia) && !guild.features.includes('MEDIA_CHANNELS')) throw new Error('The target server does not support media channels.');
  const existing = [...channels.values()].filter(Boolean);
  if (existing.some(c => !c.deletable)) throw new Error('Some existing channels cannot be deleted by the bot. Nothing was changed.');
  return existing;
}
async function replace(guild, snapshot, existing, commandChannelId) {
  const result = { deleted: 0, created: 0, errors: [], stopped: false };
  // Delete children before categories and the command channel last when possible.
  const sorted = [...existing].sort((a, b) => (a.id === commandChannelId ? 2 : a.type === ChannelType.GuildCategory ? 1 : 0) - (b.id === commandChannelId ? 2 : b.type === ChannelType.GuildCategory ? 1 : 0));
  for (const channel of sorted) {
    try { await channel.delete('Administrator-confirmed channel backup replacement'); result.deleted++; }
    catch (err) { result.errors.push(`Delete ${channel.name}: ${err.message}`); result.stopped = true; return result; }
  }
  const parents = new Map();
  const ordered = [...snapshot.channels].sort((a, b) => (a.type === ChannelType.GuildCategory ? 0 : 1) - (b.type === ChannelType.GuildCategory ? 0 : 1) || a.position - b.position);
  for (const c of ordered) {
    if (c.parentId && !parents.has(c.parentId)) { result.errors.push(`Create ${c.name}: category failed`); continue; }
    try {
      const created = await guild.channels.create({ name: c.name, type: c.type, ...(c.parentId ? { parent: parents.get(c.parentId) } : {}), permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }], reason: 'Administrator-confirmed channel backup replacement' });
      if (c.type === ChannelType.GuildCategory) parents.set(c.id, created.id);
      result.created++;
    } catch (err) { result.errors.push(`Create ${c.name}: ${err.message}`); }
  }
  return result;
}
module.exports = { plan, validate, save, load, checkTarget, replace };
