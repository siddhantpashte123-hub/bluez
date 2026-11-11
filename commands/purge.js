/**
 * /purge <amount>
 * Bulk deletes up to 100 recent messages in the current channel.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('🧹 Bulk delete up to 100 messages in this channel.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount', true);

    // Ephemeral, so the purge does not delete its own status message.
    await interaction.reply({
      embeds: [embeds.loading(interaction, `Deleting ${amount} message${amount === 1 ? '' : 's'}...`)],
      flags: MessageFlags.Ephemeral,
    });

    // Double-check permissions (the member AND the bot need Manage Messages).
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'Missing Permission', 'You need the **Manage Messages** permission to use this command.')],
      });
    }
    const needed = [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ViewChannel];
    if (!interaction.appPermissions?.has(needed) || typeof interaction.channel?.bulkDelete !== 'function') {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'I Cannot Do That Here', 'I need **View Channel**, **Read Message History** and **Manage Messages** in this channel.')],
      });
    }

    // `true` = silently skip messages older than 14 days (Discord cannot bulk delete those).
    const deleted = await interaction.channel.bulkDelete(amount, true);
    const skipped = amount - deleted.size;

    await interaction.editReply({
      embeds: [
        embeds.success(interaction, 'Channel Cleaned', `Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'} in ${interaction.channel}.`, {
          fields: [
            { name: '🗑️ Deleted', value: `${deleted.size}`, inline: true },
            { name: '⏭️ Skipped', value: `${skipped}`, inline: true },
            { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
          ],
          footer: skipped ? 'Messages older than 14 days cannot be bulk deleted' : undefined,
        }),
      ],
    });
  },
};
