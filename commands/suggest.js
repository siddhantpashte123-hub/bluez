/**
 * /suggest setup <channel>   choose the suggestions channel (admins)
 * /suggest idea <text>       post a suggestion with 👍 / 👎 buttons
 *
 * Storage (data/settings.json): { "<guildId>": { "suggestChannelId": "..." } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const polls = require('./poll');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('💡 Suggestions.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('setup').setDescription('⚙️ Choose the suggestions channel (admins).')
        .addChannelOption((o) => o.setName('channel').setDescription('Suggestions channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )
    .addSubcommand((s) => s.setName('idea').setDescription('💡 Suggest something for the server.').addStringOption((o) => o.setName('text').setDescription('Your suggestion').setRequired(true).setMinLength(5).setMaxLength(1000))),

  async execute(interaction) {
    const { guild } = interaction;
    const canPost = (channel) => channel?.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);

    if (interaction.options.getSubcommand() === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission for this.')));
      }
      const channel = interaction.options.getChannel('channel', true);
      if (!canPost(channel)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`)));
      db.updateGuild('settings', guild.id, (s) => {
        s.suggestChannelId = channel.id;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Suggestions Enabled', `Suggestions from \`/suggest idea\` will be posted in ${channel}.`)] });
    }

    const channelId = db.guild('settings', guild.id).suggestChannelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel || !canPost(channel)) {
      return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Suggestions Are Not Set Up', 'An admin has to run `/suggest setup` first.')));
    }
    const message = await polls.createPoll(interaction, channel, {
      question: interaction.options.getString('text', true).trim(),
      options: ['👍 Upvote', '👎 Downvote'],
      authorId: interaction.user.id,
      kind: 'suggestion',
    });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Suggestion Posted', `Thank you! See it here: ${message.url ?? channel}`)));
  },
};
