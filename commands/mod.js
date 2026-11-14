/**
 * Moderation
 * ---------------------------------------------------------------
 * /mod ban <user> [reason] [delete_days]
 * /mod kick <user> [reason]
 * /mod timeout <user> <duration> [reason]      e.g. 10m, 2h, 1d (max 28d)
 * /mod untimeout <user>
 * /mod warn <user> <reason>
 * /mod warnings <user>
 * /mod clearwarns <user>
 * /mod lock [reason]   /mod unlock            (current channel)
 * /mod slowmode <seconds>                     (0 = off)
 *
 * Every action is written to the log channel (/logs set).
 * Storage (data/warns.json): { "<guildId>": { "<userId>": [ { reason, by, at } ] } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const logs = require('./logs');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord limit
const P = PermissionFlagsBits;

/** Permission each subcommand needs (member AND bot). */
const NEEDS = {
  ban: [P.BanMembers, 'Ban Members'],
  kick: [P.KickMembers, 'Kick Members'],
  timeout: [P.ModerateMembers, 'Timeout Members'],
  untimeout: [P.ModerateMembers, 'Timeout Members'],
  warn: [P.ModerateMembers, 'Timeout Members'],
  warnings: [P.ModerateMembers, 'Timeout Members'],
  clearwarns: [P.ModerateMembers, 'Timeout Members'],
  lock: [P.ManageChannels, 'Manage Channels'],
  unlock: [P.ManageChannels, 'Manage Channels'],
  slowmode: [P.ManageChannels, 'Manage Channels'],
};

/** Write a moderation action to the log channel. */
function logAction(interaction, title, fields) {
  return logs.sendLog(interaction.guild, {
    embeds: [embeds.make(interaction, { color: embeds.COLORS.pink, title, fields: [...fields, { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true }] })],
  });
}

/** Tell the member privately what happened (ignored when DMs are closed). */
function notify(interaction, user, title, reason) {
  return user
    .send({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.pink,
          title,
          fields: [
            { name: '🏠 Server', value: interaction.guild.name, inline: true },
            { name: '📝 Reason', value: reason },
          ],
          thumbnail: interaction.guild.iconURL({ size: 256 }) ?? undefined,
        }),
      ],
    })
    .catch(() => {});
}

/**
 * Can the moderator (and the bot) act on this member?
 * Returns an error text, or null when everything is fine.
 */
function hierarchyProblem(interaction, member) {
  const { guild, user } = interaction;
  if (!member) return null; // not in the server (only possible for ban)
  if (member.id === user.id) return 'You cannot do that to yourself.';
  if (member.id === interaction.client.user.id) return 'I cannot do that to myself.';
  if (member.id === guild.ownerId) return 'The server owner cannot be moderated.';
  if (guild.ownerId !== user.id && interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return 'That member has the same or a higher role than you.';
  }
  if (guild.members.me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return 'That member has the same or a higher role than me. Move my role above theirs.';
  }
  return null;
}

const userOpt = (o, text = 'The member') => o.setName('user').setDescription(text).setRequired(true);
const reasonOpt = (o, required = false) => o.setName('reason').setDescription('Reason').setMaxLength(400).setRequired(required);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('🛡️ Moderation tools.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addSubcommand((s) =>
      s.setName('ban').setDescription('🔨 Ban a user.').addUserOption((o) => userOpt(o, 'User to ban')).addStringOption((o) => reasonOpt(o))
        .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages of the last N days (0-7)').setMinValue(0).setMaxValue(7)),
    )
    .addSubcommand((s) => s.setName('kick').setDescription('👢 Kick a member.').addUserOption((o) => userOpt(o, 'Member to kick')).addStringOption((o) => reasonOpt(o)))
    .addSubcommand((s) =>
      s.setName('timeout').setDescription('🔇 Timeout (mute) a member.').addUserOption((o) => userOpt(o, 'Member to timeout'))
        .addStringOption((o) => o.setName('duration').setDescription('How long? e.g. 10m, 2h, 1d (max 28d)').setRequired(true).setMaxLength(20))
        .addStringOption((o) => reasonOpt(o)),
    )
    .addSubcommand((s) => s.setName('untimeout').setDescription('🔊 Remove a timeout.').addUserOption((o) => userOpt(o)))
    .addSubcommand((s) => s.setName('warn').setDescription('⚠️ Warn a member.').addUserOption((o) => userOpt(o, 'Member to warn')).addStringOption((o) => reasonOpt(o, true)))
    .addSubcommand((s) => s.setName('warnings').setDescription('📒 Show the warnings of a member.').addUserOption((o) => userOpt(o)))
    .addSubcommand((s) => s.setName('clearwarns').setDescription('🧽 Delete all warnings of a member.').addUserOption((o) => userOpt(o)))
    .addSubcommand((s) => s.setName('lock').setDescription('🔒 Stop @everyone from sending messages in this channel.').addStringOption((o) => reasonOpt(o)))
    .addSubcommand((s) => s.setName('unlock').setDescription('🔓 Unlock this channel again.'))
    .addSubcommand((s) =>
      s.setName('slowmode').setDescription('🐢 Set the slowmode of this channel.')
        .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds between messages (0 = off, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, channel } = interaction;
    const [permission, permissionName] = NEEDS[sub];
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    if (!interaction.memberPermissions?.has(permission)) return fail('Missing Permission', `You need the **${permissionName}** permission for this.`);
    if (!guild.members.me.permissions.has(permission)) return fail('I Am Missing Permissions', `I need the **${permissionName}** permission for this.`);

    /* ---------- channel tools ---------- */
    if (sub === 'lock' || sub === 'unlock') {
      if (!channel?.permissionOverwrites) return fail('Not Supported', 'This channel type cannot be locked.');
      // false = denied for @everyone, null = back to the default
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: sub === 'lock' ? false : null }, { reason: `${sub} by ${interaction.user.tag}` });
      const reason = interaction.options.getString('reason');
      logAction(interaction, sub === 'lock' ? '🔒 Channel Locked' : '🔓 Channel Unlocked', [{ name: '📁 Channel', value: `${channel}`, inline: true }]);
      return interaction.reply({
        embeds: [
          sub === 'lock'
            ? embeds.make(interaction, { color: embeds.COLORS.pink, title: '🔒 Channel Locked', description: `Members can no longer send messages in ${channel}.${reason ? `\n**Reason:** ${reason}` : ''}` })
            : embeds.success(interaction, 'Channel Unlocked', `Members can send messages in ${channel} again.`),
        ],
      });
    }
    if (sub === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds', true);
      if (typeof channel?.setRateLimitPerUser !== 'function') return fail('Not Supported', 'This channel type has no slowmode.');
      await channel.setRateLimitPerUser(seconds, `Slowmode by ${interaction.user.tag}`);
      return interaction.reply({
        embeds: [embeds.success(interaction, seconds ? 'Slowmode Enabled' : 'Slowmode Disabled', seconds ? `Members can send one message every **${seconds}s** in ${channel}.` : `Slowmode is off in ${channel}.`)],
      });
    }

    /* ---------- member tools ---------- */
    const user = interaction.options.getUser('user', true);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const reason = interaction.options.getString('reason') ?? 'No reason given';
    const audit = `${reason} — by ${interaction.user.tag}`.slice(0, 500);

    if (sub === 'warnings') {
      const list = db.guild('warns', guild.id)[user.id] ?? [];
      return interaction.reply({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.gold,
            title: `📒 Warnings of ${user.username} (${list.length})`,
            description: list.length
              ? list.slice(-15).map((w, i) => `**${i + 1}.** ${w.reason}\n┗ by <@${w.by}> • <t:${Math.floor(w.at / 1000)}:R>`).join('\n\n')
              : '*This member has no warnings.* ✨',
            thumbnail: user.displayAvatarURL({ size: 256 }),
          }),
        ],
      });
    }
    if (sub === 'clearwarns') {
      const count = (db.guild('warns', guild.id)[user.id] ?? []).length;
      db.updateGuild('warns', guild.id, (w) => {
        delete w[user.id];
      });
      logAction(interaction, '🧽 Warnings Cleared', [{ name: '👤 Member', value: `${user}`, inline: true }, { name: '🔢 Removed', value: `${count}`, inline: true }]);
      return interaction.reply({ embeds: [embeds.success(interaction, 'Warnings Cleared', `Removed **${count}** warning${count === 1 ? '' : 's'} from ${user}.`)] });
    }

    if (user.bot && sub === 'warn') return fail('Cannot Warn a Bot', 'Bots cannot be warned.');
    const problem = hierarchyProblem(interaction, member);
    if (problem) return fail('Cannot Do That', problem);
    if (!member && sub !== 'ban') return fail('Member Not Found', 'That user is not in this server.');

    await interaction.reply({ embeds: [embeds.loading(interaction, 'Working...')] });
    const done = (title, text, fields = []) =>
      interaction.editReply({
        embeds: [embeds.success(interaction, title, text, { fields: [...fields, { name: '📝 Reason', value: reason }], thumbnail: user.displayAvatarURL({ size: 256 }) })],
      });

    if (sub === 'warn') {
      const list = db.updateGuild('warns', guild.id, (w) => {
        (w[user.id] ??= []).push({ reason, by: interaction.user.id, at: Date.now() });
      })[user.id];
      await notify(interaction, user, '⚠️ You Were Warned', reason);
      logAction(interaction, '⚠️ Member Warned', [{ name: '👤 Member', value: `${user}`, inline: true }, { name: '🔢 Total', value: `${list.length}`, inline: true }, { name: '📝 Reason', value: reason }]);
      return done('Member Warned', `${user} now has **${list.length}** warning${list.length === 1 ? '' : 's'}.`);
    }

    if (sub === 'timeout') {
      const duration = embeds.parseDuration(interaction.options.getString('duration', true));
      if (!duration || duration < 5000 || duration > MAX_TIMEOUT_MS) {
        return interaction.editReply({ embeds: [embeds.error(interaction, 'Invalid Duration', 'Use something like `10m`, `2h` or `1d`. Maximum is 28 days.')] });
      }
      await member.timeout(duration, audit);
      const until = Math.floor((Date.now() + duration) / 1000);
      await notify(interaction, user, '🔇 You Were Timed Out', `${reason}\nEnds <t:${until}:R>`);
      logAction(interaction, '🔇 Member Timed Out', [{ name: '👤 Member', value: `${user}`, inline: true }, { name: '⏰ Until', value: `<t:${until}:R>`, inline: true }, { name: '📝 Reason', value: reason }]);
      return done('Member Timed Out', `${user} cannot chat or speak until <t:${until}:f>.`, [{ name: '⏰ Ends', value: `<t:${until}:R>`, inline: true }]);
    }

    if (sub === 'untimeout') {
      await member.timeout(null, audit);
      logAction(interaction, '🔊 Timeout Removed', [{ name: '👤 Member', value: `${user}`, inline: true }]);
      return interaction.editReply({ embeds: [embeds.success(interaction, 'Timeout Removed', `${user} can chat again.`)] });
    }

    if (sub === 'kick') {
      await notify(interaction, user, '👢 You Were Kicked', reason); // before the kick, afterwards the DM may fail
      await member.kick(audit);
      logAction(interaction, '👢 Member Kicked', [{ name: '👤 Member', value: `${user} (\`${user.tag}\`)`, inline: true }, { name: '📝 Reason', value: reason }]);
      return done('Member Kicked', `**${user.tag}** was kicked from the server.`);
    }

    // ban
    const days = interaction.options.getInteger('delete_days') ?? 0;
    if (member) await notify(interaction, user, '🔨 You Were Banned', reason);
    await guild.members.ban(user.id, { reason: audit, deleteMessageSeconds: days * 86400 });
    logAction(interaction, '🔨 User Banned', [{ name: '👤 User', value: `${user} (\`${user.tag}\`)`, inline: true }, { name: '📝 Reason', value: reason }]);
    return done('User Banned', `**${user.tag}** was banned from the server.`, days ? [{ name: '🗑️ Messages deleted', value: `Last ${days} day${days === 1 ? '' : 's'}`, inline: true }] : []);
  },
};
