/**
 * /logs set <channel>   choose the channel for server logs
 * /logs off             stop logging
 *
 * Logged: deleted / edited messages, member joins / leaves, moderation
 * actions, automod hits and ticket transcripts.
 * Other files log with:  logs.sendLog(guild, { embeds: [...] })
 *
 * Storage (data/settings.json):  { "<guildId>": { "logChannelId": "..." } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

/**
 * Send something to the log channel of a guild.
 * Returns true when it was sent, false when logging is off / not possible.
 */
async function sendLog(guild, payload) {
  const channelId = db.guild('settings', guild.id).logChannelId;
  if (!channelId) return false;
  try {
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
    await channel.send({ ...payload, allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error(`[Logs] Could not write to the log channel of "${guild.name}":`, err.message);
    return false;
  }
}

module.exports = {
  sendLog,

  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('📋 Server log channel.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('📋 Choose the channel where logs are posted.')
        .addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('off').setDescription('🚫 Turn logging off.')),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'off') {
      db.updateGuild('settings', interaction.guildId, (s) => {
        delete s.logChannelId;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Logging Disabled', 'I will no longer post server logs.')] });
    }

    const channel = interaction.options.getChannel('channel', true);
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
      return interaction.reply(
        embeds.ephemeral(embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages**, **Embed Links** and **Attach Files** in ${channel}.`)),
      );
    }
    db.updateGuild('settings', interaction.guildId, (s) => {
      s.logChannelId = channel.id;
    });
    return interaction.reply({
      embeds: [
        embeds.success(interaction, 'Log Channel Set', `Server logs will be posted in ${channel}.`, {
          fields: [{ name: '📝 What is logged', value: 'Deleted and edited messages, joins and leaves, moderation actions, automod hits, ticket transcripts.' }],
        }),
      ],
    });
  },
};
