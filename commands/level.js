/**
 * Level / XP system
 * ---------------------------------------------------------------
 * /level rank [user]         show level, XP and server rank
 * /level leaderboard         top 10 by XP
 * /level toggle <enabled>    turn the XP system on or off (admins)
 *
 * Members earn 15-25 XP per message, at most once per minute.
 * `addXp(message)` is called from events/messageCreate.js.
 *
 * Storage: data/levels.json   { "<guildId>": { "<userId>": { xp, level } } }
 *          data/settings.json { "<guildId>": { "levels": true } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');
const cards = require('../utils/cards');
const db = require('../utils/db');

const XP_COOLDOWN_MS = 60_000;
const MEDALS = ['🥇', '🥈', '🥉'];
/** "guildId:userId" -> last time XP was given */
const cooldowns = new Map();

/** XP needed to go from `level` to the next one. */
const xpForNext = (level) => 5 * level * level + 50 * level + 100;

/** Total XP -> { level, into (XP inside the level), needed }. */
function progress(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (rest >= xpForNext(level)) {
    rest -= xpForNext(level);
    level++;
  }
  return { level, into: rest, needed: xpForNext(level) };
}

/** Give XP for a chat message; announces level-ups. */
async function addXp(message) {
  if (!db.guild('settings', message.guildId).levels) return;
  const key = `${message.guildId}:${message.author.id}`;
  if (Date.now() - (cooldowns.get(key) ?? 0) < XP_COOLDOWN_MS) return;
  cooldowns.set(key, Date.now());

  let leveledTo = null;
  db.updateGuild('levels', message.guildId, (data) => {
    const entry = (data[message.author.id] ??= { xp: 0, level: 0 });
    entry.xp += 15 + Math.floor(Math.random() * 11);
    const { level } = progress(entry.xp);
    if (level > entry.level) leveledTo = level;
    entry.level = level;
  });

  if (leveledTo !== null) {
    // Level role rewards (every reward up to the new level).
    const rewards = db.guild('settings', message.guildId).levelRewards ?? {};
    for (const [level, roleId] of Object.entries(rewards)) {
      if (Number(level) <= leveledTo && !message.member?.roles.cache.has(roleId)) {
        await message.member?.roles.add(roleId, 'Level reward').catch((err) => console.error('[Levels] reward role:', err.message));
      }
    }
    await message.channel
      .send({
        embeds: [
          embeds.make(message, {
            color: embeds.COLORS.gold,
            title: `${embeds.e('boostShine')} Level Up!`,
            description: `${message.author} reached **level ${leveledTo}**! ${embeds.e('boostGem24')}`,
            thumbnail: message.author.displayAvatarURL({ size: 256 }),
          }),
        ],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}

const ranking = (guildId) => Object.entries(db.guild('levels', guildId)).sort((a, b) => b[1].xp - a[1].xp);

module.exports = {
  addXp,

  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('⭐ Levels and XP.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('rank').setDescription('⭐ Show your level and rank.').addUserOption((o) => o.setName('user').setDescription('Another member')))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('🏆 Top 10 members by XP.'))
    .addSubcommand((s) =>
      s.setName('reward').setDescription('🎭 Give a role at a level (admins). Leave the role empty to remove.')
        .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(500))
        .addRoleOption((o) => o.setName('role').setDescription('Reward role')),
    )
    .addSubcommand((s) => s.setName('toggle').setDescription('⚙️ Turn the level system on or off (admins).').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'toggle') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission for this.')));
      }
      const enabled = interaction.options.getBoolean('enabled', true);
      db.updateGuild('settings', guildId, (s) => {
        s.levels = enabled;
      });
      return interaction.reply({
        embeds: [embeds.success(interaction, enabled ? 'Level System Enabled' : 'Level System Disabled', enabled ? 'Members now earn XP by chatting (once per minute).' : 'Members no longer earn XP. Existing levels are kept.')],
      });
    }

    if (sub === 'reward') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission for this.')));
      }
      const level = interaction.options.getInteger('level', true);
      const role = interaction.options.getRole('role');
      const me = interaction.guild.members.me;
      if (role && (role.managed || role.id === guildId || role.position >= me.roles.highest.position || !me.permissions.has(PermissionFlagsBits.ManageRoles))) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Give That Role', 'I need **Manage Roles**, and the role must be **below my highest role**.')));
      }
      db.updateGuild('settings', guildId, (s) => {
        s.levelRewards ??= {};
        if (role) s.levelRewards[level] = role.id;
        else delete s.levelRewards[level];
      });
      const all = Object.entries(db.guild('settings', guildId).levelRewards).sort((a, b) => a[0] - b[0]).map(([lvl, id]) => `Level **${lvl}** → <@&${id}>`);
      return interaction.reply({ embeds: [embeds.success(interaction, role ? 'Level Reward Saved' : 'Level Reward Removed', all.join('\n') || '*No level rewards.*')], allowedMentions: { parse: [] } });
    }

    if (!db.guild('settings', guildId).levels) {
      return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Level System Is Off', 'An admin can turn it on with `/level toggle enabled:True`.')));
    }
    const board = ranking(guildId);

    if (sub === 'leaderboard') {
      if (!board.length) return interaction.reply({ embeds: [embeds.warn(interaction, 'No XP Yet', 'Start chatting to earn XP!')] });
      const own = board.findIndex(([id]) => id === interaction.user.id);
      return interaction.reply({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.gold,
            title: `${embeds.e('giftLegend')} Level Leaderboard`,
            description: board.slice(0, 10).map(([id, entry], i) => `${MEDALS[i] ?? `\`#${i + 1}\``} <@${id}> — **Level ${entry.level}** *(${entry.xp.toLocaleString('en-IN')} XP)*`).join('\n'),
            fields: [{ name: '📍 Your Rank', value: own === -1 ? 'Unranked' : `#${own + 1}`, inline: true }],
            thumbnail: interaction.guild.iconURL({ size: 256 }) ?? undefined,
          }),
        ],
      });
    }

    const user = interaction.options.getUser('user') ?? interaction.user;
    const entry = db.guild('levels', guildId)[user.id] ?? { xp: 0, level: 0 };
    const { level, into, needed } = progress(entry.xp);
    const rank = board.findIndex(([id]) => id === user.id);

    // Premium look: rank card image (falls back to the embed below when images are not available).
    if (cards.available()) {
      await interaction.deferReply();
      const member = interaction.guild.members.cache.get(user.id);
      const png = await cards
        .rankCard({ username: member?.displayName ?? user.username, avatarUrl: user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 }), level, rank: rank === -1 ? null : rank + 1, xp: into, needed, totalXp: entry.xp })
        .catch((err) => (console.error('[/level rank] card failed:', err.message), null));
      if (png) {
        return interaction.editReply({
          embeds: [embeds.make(interaction, { color: embeds.COLORS.cyan, image: 'attachment://rank.png', thumbnail: false })],
          files: [new AttachmentBuilder(png, { name: 'rank.png' })],
        });
      }
    }
    const send = (payload) => (interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload));
    return send({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.cyan,
          title: `⭐ Rank of ${user.username}`,
          description: `\`${embeds.bar(into, needed, 18)}\` **${Math.floor((into / needed) * 100)}%**`,
          fields: [
            { name: '🏅 Level', value: `${level}`, inline: true },
            { name: '📍 Rank', value: rank === -1 ? 'Unranked' : `#${rank + 1}`, inline: true },
            { name: '✨ XP', value: `${into} / ${needed}`, inline: true },
            { name: '📊 Total XP', value: entry.xp.toLocaleString('en-IN'), inline: true },
          ],
          thumbnail: user.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
