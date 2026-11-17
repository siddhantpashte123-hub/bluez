const db = require('./db');
const attempts = new Map();
const CHECK_RETRY_MS = 15 * 60_000;

function activity(message) {
  const ticket = db.guild('tickets', message.guildId).tickets?.[message.channelId];
  if (!ticket) return;
  const now = Date.now();
  if (!ticket.alertedAt && now - (ticket.lastActivityAt ?? ticket.openedAt ?? 0) < 60_000) return;
  db.update('tickets', (store) => {
    const current = store[message.guildId]?.tickets?.[message.channelId];
    if (current) { current.lastActivityAt = now; delete current.alertedAt; }
  });
}

async function tick(client, now = Date.now()) {
  for (const [guildId, config] of Object.entries(db.get('tickets'))) {
    const hours = config.inactivityHours;
    if (!(hours > 0)) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const [channelId, ticket] of Object.entries(config.tickets ?? {})) {
      const last = ticket.lastActivityAt ?? ticket.openedAt;
      if (!last || now - last < hours * 3600000 || ticket.alertedAt >= last) continue;
      const key = `${guildId}:${channelId}`;
      if (now - (attempts.get(key) ?? 0) < CHECK_RETRY_MS) continue;
      attempts.set(key, now);
      const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.send) continue;
      const roleId = ticket.supportRoleId ?? config.supportRoleId;
      const sent = await channel.send({ content: `${roleId ? `<@&${roleId}> ` : ''}⏳ Ticket #${ticket.number} has had no member activity for ${hours} hour(s). Please check on it.`, allowedMentions: { parse: [], roles: roleId ? [roleId] : [] } }).then(() => true).catch(() => false);
      if (sent) db.update('tickets', (store) => {
        const current = store[guildId]?.tickets?.[channelId];
        if (current && (current.lastActivityAt ?? current.openedAt) === last) current.alertedAt = now;
      });
    }
  }
}
module.exports = { activity, tick };
