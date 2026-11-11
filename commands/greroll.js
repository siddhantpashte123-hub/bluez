/**
 * /greroll [message_id] [winners]
 * Picks new winner(s) for a giveaway that has already ended.
 * Without an ID it rerolls the newest ended giveaway in this channel.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const giveaways = require('./gcreate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('greroll')
    .setDescription('🔄 Pick new winner(s) for an ended giveaway.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID or link (default: newest ended in this channel)').setMaxLength(120))
    .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners (default: same as before)').setMinValue(1).setMaxValue(20)),

  async execute(interaction) {
    await interaction.reply({ embeds: [embeds.loading(interaction, 'Rerolling...')] });

    const found = giveaways.findGiveaway(interaction, interaction.options.getString('message_id'), true);
    if (!found || !found[1].ended) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'No Ended Giveaway Found', 'There is no ended giveaway with that ID / in this channel. Use `/gend` to end a running one first.')],
      });
    }

    const [messageId, g] = found;
    const winnerIds = await giveaways.rerollGiveaway(interaction.client, messageId, interaction.options.getInteger('winners') ?? g.winners);
    if (!winnerIds?.length) {
      return interaction.editReply({ embeds: [embeds.warn(interaction, 'Nobody to Pick', 'Nobody entered that giveaway.')] });
    }

    const list = winnerIds.map((id) => `<@${id}>`).join(', ');
    await interaction.editReply({
      content: list,
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.green,
          title: `${embeds.e('giftLegend')} New Winner${winnerIds.length === 1 ? '' : 's'}!`,
          description: `${list} won **${g.prize}**! ${embeds.e('bow')}\nPress the button below to open a private ticket and claim your prize.`,
        }),
      ],
      components: [giveaways.claimRow(messageId)],
      allowedMentions: { users: winnerIds },
    });
  },
};
