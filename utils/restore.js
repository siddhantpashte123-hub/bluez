// Safe, additive skeleton restore. Never applies saved permissions or deletes/edits existing resources.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const MAX_BYTES = 1_000_000;
const TYPES = new Set([ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildVoice]);
async function readSnapshot(attachment) {
  if (!attachment || attachment.size > MAX_BYTES || !attachment.name?.endsWith('.json')) throw new Error('Upload a JSON snapshot smaller than 1 MB.');
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || url.port) throw new Error('Only Discord attachment URLs are accepted.');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error('Could not download the attachment.');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Snapshot is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Snapshot is too large.'); chunks.push(Buffer.from(chunk)); }
  return plan(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
function plan(snapshot) {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.guild?.id !== 'string' || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.channels)) throw new Error('Not a supported backup snapshot.');
  const validName = (name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 100 && !/[\r\n]/.test(name);
  const roles = snapshot.roles.filter((r) => r && !r.managed && r.id !== snapshot.guild.id && validName(r.name));
  const channels = snapshot.channels.filter((c) => c && TYPES.has(c.type) && typeof c.id === 'string' && validName(c.name));
  if (roles.length > 25 || channels.length > 50) throw new Error('Snapshot exceeds safety limit: 25 roles and 50 supported channels per restore.');
  if (new Set(channels.map((c) => c.id)).size !== channels.length) throw new Error('Snapshot has duplicate channel IDs.');
  return { roles, channels, skippedRoles: snapshot.roles.length - roles.length, skippedChannels: snapshot.channels.length - channels.length };
}
async function apply(guild, blueprint) {
  const result = { roles: 0, channels: 0, errors: [] };
  const parents = new Map();
  const overwrite = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
  for (const role of blueprint.roles) {
    try { await guild.roles.create({ name: role.name, color: Number.isInteger(role.color) && role.color >= 0 && role.color <= 0xffffff ? role.color : 0, hoist: Boolean(role.hoist), mentionable: false, permissions: 0n, reason: 'Safe backup skeleton restore' }); result.roles++; }
    catch (err) { result.errors.push(`Role ${role.name}: ${err.message}`); }
  }
  const ordered = [...blueprint.channels].sort((a, b) => (a.type === ChannelType.GuildCategory ? 0 : 1) - (b.type === ChannelType.GuildCategory ? 0 : 1));
  for (const channel of ordered) {
    if (channel.type !== ChannelType.GuildCategory && channel.parentId && !parents.has(channel.parentId)) { result.errors.push(`Channel ${channel.name}: parent not restored`); continue; }
    try {
      const created = await guild.channels.create({ name: channel.name, type: channel.type, ...(channel.parentId ? { parent: parents.get(channel.parentId) } : {}), permissionOverwrites: overwrite, reason: 'Safe backup skeleton restore' });
      if (channel.type === ChannelType.GuildCategory) parents.set(channel.id, created.id);
      result.channels++;
    } catch (err) { result.errors.push(`Channel ${channel.name}: ${err.message}`); }
  }
  return result;
}
module.exports = { readSnapshot, plan, apply };
