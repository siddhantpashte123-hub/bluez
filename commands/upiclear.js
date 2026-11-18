const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const settings = require('../utils/upi-settings');
module.exports = {
  data: new SlashCommandBuilder().setName('upiclear').setDescription('Remove your saved UPI ID for this server.').setContexts(InteractionContextType.Guild),
  async execute(i) {
    try {
      const removed = settings.clear(i.guildId ?? i.guild.id, i.user.id);
      return i.reply(embeds.ephemeral(removed ? embeds.success(i, 'UPI ID Removed', 'Your saved UPI ID and name were removed for this server. Shop payment settings are unchanged.') : embeds.info(i, 'Nothing Saved', 'You have no saved UPI ID in this server.')));
    } catch { return i.reply(embeds.ephemeral(embeds.error(i, 'Could Not Remove', 'Could not update UPI settings. Check bot storage and try again.'))); }
  },
};
