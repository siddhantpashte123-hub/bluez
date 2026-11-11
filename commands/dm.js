/**
 * /dm @user <message>
 * Sends a DM to one member on behalf of the server staff.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('📨 Send a direct message to a member through the bot.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('user').setDescription('Who should receive the DM?').setRequired(true))
    .addStringOption((o) =>
      o.setName('message').setDescription('The message to send').setRequired(true).setMaxLength(1800),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const text = interaction.options.getString('message', true);

    // loading -> final
    await interaction.reply({
      embeds: [embeds.loading(interaction, `Sending DM to ${user.username}...`)],
      flags: MessageFlags.Ephemeral,
    });

    if (user.bot) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'Cannot DM a Bot', 'Bots cannot receive direct messages from other bots.')],
      });
    }

    try {
      await user.send({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.blurple,
            title: '📬 You have a new message',
            description: text,
            fields: [{ name: '🏠 Sent from', value: interaction.guild.name, inline: true }],
            thumbnail: interaction.guild.iconURL({ size: 256 }) ?? undefined,
          }),
        ],
      });

      await interaction.editReply({
        embeds: [
          embeds.success(interaction, 'DM Delivered', `Your message was sent to ${user}.`, {
            fields: [
              { name: '👤 Recipient', value: `${user.tag}`, inline: true },
              { name: '📝 Message', value: text.slice(0, 1024) },
            ],
            thumbnail: user.displayAvatarURL({ size: 256 }),
          }),
        ],
      });
    } catch (err) {
      console.error('[/dm]', err.message);
      // 50007 = "Cannot send messages to this user" (DMs closed / bot blocked)
      const reason =
        err.code === 50007
          ? `${user} has DMs disabled or has blocked the bot.`
          : 'Discord refused to deliver the message. Please try again later.';
      await interaction.editReply({ embeds: [embeds.error(interaction, 'DM Failed', reason)] });
    }
  },
};
