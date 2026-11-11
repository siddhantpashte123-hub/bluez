/**
 * /invites
 * Server invite leaderboard (top 10).
 *
 * Also exports the invite helpers used by /invited and events/ready.js.
 * Storage layout (data/invites.json):
 *   { "<guildId>": { "<inviterId>": { "codes": { "<code>": <uses> } } } }
 * Codes stay stored after an invite expires/gets deleted, so nobody
 * loses their count.
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Pull the live invite list from Discord and merge it into invites.json.
 * Needs the bot to have the "Manage Server" permission.
 * @returns {Promise<object>} this guild's invite data
 */
async function syncInvites(guild) {
  const live = await guild.invites.fetch({ cache: false });
  let result;
  db.update('invites', (data) => {
    if (!data[guild.id]) data[guild.id] = {};
    for (const invite of live.values()) {
      const inviterId = invite.inviterId ?? invite.inviter?.id;
      if (!inviterId) continue; // vanity / widget invites have no inviter
      const entry = (data[guild.id][inviterId] ??= { codes: {} });
      entry.codes[invite.code] = Math.max(entry.codes[invite.code] ?? 0, invite.uses ?? 0);
    }
    result = data[guild.id];
  });
  return result;
}

/** Stored invite data of a guild (without contacting Discord). */
function storedInvites(guildId) {
  return db.get('invites')[guildId] ?? {};
}

/** Total uses of one inviter entry. */
function totalOf(entry) {
  return Object.values(entry?.codes ?? {}).reduce((sum, uses) => sum + uses, 0);
}

module.exports = {
  syncInvites,
  storedInvites,
  totalOf,

  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('🏆 Show the invite leaderboard of this server.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    await interaction.reply({ embeds: [embeds.loading(interaction, 'Loading invite leaderboard...')] });

    let data;
    let stale = false;
    try {
      data = await syncInvites(guild);
    } catch (err) {
      // Usually "Missing Permissions" -> fall back to what we have stored.
      console.error('[/invites] sync failed:', err.message);
      data = storedInvites(guild.id);
      stale = true;
    }

    const ranking = Object.entries(data)
      .map(([userId, entry]) => ({ userId, total: totalOf(entry), codes: Object.keys(entry.codes).length }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);

    if (!ranking.length) {
      return interaction.editReply({
        embeds: [
          embeds.warn(
            interaction,
            'No Invites Yet',
            stale
              ? 'I could not read the invites. Please give me the **Manage Server** permission and try again.'
              : 'Nobody has invited members with a tracked invite link yet. Create an invite and share it! 🔗',
          ),
        ],
      });
    }

    const lines = ranking.slice(0, 10).map((row, i) => {
      const rank = MEDALS[i] ?? `\`#${i + 1}\``;
      return `${rank} <@${row.userId}> — **${row.total}** invite${row.total === 1 ? '' : 's'} *(${row.codes} link${row.codes === 1 ? '' : 's'})*`;
    });

    const own = ranking.findIndex((row) => row.userId === interaction.user.id);

    await interaction.editReply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.gold,
          title: `🏆 Invite Leaderboard — ${guild.name}`,
          description: lines.join('\n'),
          fields: [
            { name: '👥 Inviters', value: `${ranking.length}`, inline: true },
            { name: '📨 Total Invites', value: `${ranking.reduce((s, r) => s + r.total, 0)}`, inline: true },
            { name: '📍 Your Rank', value: own === -1 ? 'Unranked' : `#${own + 1} (${ranking[own].total})`, inline: true },
          ],
          thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
          footer: stale ? 'Showing saved data (missing Manage Server permission)' : 'Top 10',
        }),
      ],
    });
  },
};
