const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const settings = require('../utils/upi-settings');

module.exports = {
  data: new SlashCommandBuilder().setName('upiset').setDescription('Save your UPI ID for payment QR codes in this server.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(o => o.setName('upi_id').setDescription('UPI ID, e.g. name@bank').setRequired(true).setMinLength(3).setMaxLength(50))
    .addStringOption(o => o.setName('name').setDescription('Optional payee name').setMaxLength(60)),
  async execute(interaction) {
    const upiId = interaction.options.getString('upi_id', true).trim();
    const name = (interaction.options.getString('name') ?? '').trim();
    if (!settings.validId(upiId) || name.length > 60) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Payment Details', 'Enter a UPI ID like `name@bank` and an optional name of at most 60 characters.')));
    try { settings.save(interaction.guildId ?? interaction.guild.id, interaction.user.id, upiId, name); }
    catch { return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Could Not Save', 'UPI settings could not be saved. Check bot storage and try again.'))); }
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'UPI ID Saved', 'Your UPI ID is saved for you in this server. Use `/upiqr amount:499`. Verify the UPI ID and payee in your payment app before paying.')));
  },
};
