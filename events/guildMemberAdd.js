/**
 * events/guildMemberAdd.js
 * A member joined:
 *   1. Raid protection (may kick them -> stop)
 *   2. Find out who invited them + invite reward roles
 *   3. Auto-role
 *   4. Welcome message
 *   5. Join log
 */
const { Events } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const { syncInvites, storedInvites, totalOf } = require('../commands/invites');
const antiraid = require('../commands/antiraid');
const inviteRewards = require('../commands/inviterewards');
const welcome = require('../commands/welcome');
const logs = require('../commands/logs');

/** Compare the stored invite uses before/after a sync: whose code went up? */
async function findInviter(guild) {
  const before = JSON.parse(JSON.stringify(storedInvites(guild.id)));
  let after;
  try {
    after = await syncInvites(guild); // needs Manage Server
  } catch {
    return null;
  }
  for (const [inviterId, entry] of Object.entries(after)) {
    for (const [code, uses] of Object.entries(entry.codes)) {
      if (uses > (before[inviterId]?.codes?.[code] ?? 0)) return { inviterId, total: totalOf(entry) };
    }
  }
  return null;
}

module.exports = {
  name: Events.GuildMemberAdd,

  async execute(member) {
    const { guild } = member;
    const settings = db.guild('settings', guild.id);

    /* 1. Raid protection */
    const kicked = await antiraid.screen(member).catch(() => null);
    if (kicked) {
      await logs.sendLog(guild, { embeds: [embeds.make(member, { color: embeds.COLORS.pink, title: '🛡️ Anti-Raid Kick', description: `${member.user.tag} (\`${member.id}\`)\n**Reason:** ${kicked}`, thumbnail: member.user.displayAvatarURL({ size: 256 }) })] });
      return;
    }

    /* 2. Inviter + invite rewards */
    const invite = member.user.bot ? null : await findInviter(guild);
    if (invite) await inviteRewards.grant(guild, invite.inviterId, invite.total).catch((err) => console.error('[InviteRewards]', err.message));

    /* 3. Auto-role */
    if (settings.autoRoleId && !member.user.bot) {
      await member.roles.add(settings.autoRoleId, 'Auto-role').catch((err) => console.error('[AutoRole]', err.message));
    }

    /* 4. Welcome message */
    if (settings.welcome?.channelId) {
      try {
        const channel = guild.channels.cache.get(settings.welcome.channelId) ?? (await guild.channels.fetch(settings.welcome.channelId));
        await channel.send(welcome.welcomePayload(member, settings.welcome, invite?.inviterId ?? null));
      } catch (err) {
        console.error('[Welcome]', err.message);
      }
    }

    /* 5. Join log */
    const created = Math.floor(member.user.createdTimestamp / 1000);
    await logs.sendLog(guild, {
      embeds: [
        embeds.make(member, {
          color: embeds.COLORS.green,
          title: '📥 Member Joined',
          description: `${member} — ${member.user.tag} (\`${member.id}\`)`,
          fields: [
            { name: '📅 Account created', value: `<t:${created}:R>`, inline: true },
            { name: '📨 Invited by', value: invite ? `<@${invite.inviterId}> (${invite.total} invites)` : 'Unknown', inline: true },
            { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
          ],
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
