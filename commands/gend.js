/**
 * /gend [message_id]
 * Ends a running giveaway immediately and picks the winner(s).
 * Without an ID it ends the newest running giveaway in this channel.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');
const giveaways = require('./gcreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gend')
    .setDescription('🏁 End a giveaway now and pick the winner(s).')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID or link (default: newest in this channel)').setMaxLength(120)),

  async execute(interaction) {
    await interaction.reply({ embeds: [embeds.loading(interaction, 'Ending the giveaway...')], flags: MessageFlags.Ephemeral });

    const found = giveaways.findGiveaway(interaction, interaction.options.getString('message_id'), false);
    if (!found || found[1].ended) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'No Running Giveaway Found', 'There is no running giveaway with that ID / in this channel.')],
      });
    }

    const result = await giveaways.endGiveaway(interaction.client, found[0]);
    await interaction.editReply({
      embeds: [
        embeds.success(interaction, 'Giveaway Ended', `The giveaway for **${found[1].prize}** has been ended.`, {
          fields: [{ name: '🏆 Winner(s)', value: result?.winnerIds?.length ? result.winnerIds.map((id) => `<@${id}>`).join(', ') : '*Nobody entered*' }],
        }),
      ],
    });
  },
};
