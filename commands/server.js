const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const channelBackup = require('../utils/channel-backup');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('server').setDescription('Server channel backup tools.')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('backup').setDescription('Privately create a channel backup code.')),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use the Slash Command', 'For privacy, use `/server backup`.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Administrator Only', 'You need the Administrator permission.')));
    await interaction.deferReply({ flags: 64 });
    try {
      const me = await interaction.guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.Administrator)) throw new Error('The bot needs Administrator permission to create a complete backup.');
      const snapshot = channelBackup.plan(interaction.guild, await interaction.guild.channels.fetch());
      const code = channelBackup.save(snapshot);
      return interaction.editReply({ embeds: [embeds.info(interaction, 'Private Channel Backup', `Save this secret code securely:\n\n\`${code}\`\n\n${snapshot.channels.length} channels and categories saved. On another server, use \`/backup upload\`. Only names, types, category structure and relative order are saved; messages and permissions are not. Anyone with this code and admin rights on a target server can use it. The code remains on this bot instance and is reusable.`)] });
    } catch (err) { return interaction.editReply({ embeds: [embeds.error(interaction, 'Backup Failed', err.message.slice(0, 300))] }); }
  },
};
