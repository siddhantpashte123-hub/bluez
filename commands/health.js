const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { DATA_DIR } = require('../utils/db');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('health').setDescription('Private bot health overview (administrator).')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'For privacy, use `/health`.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Administrator Only', 'Administrator permission required.')));
    await interaction.deferReply({ flags: 64 });
    let access = 'Unavailable', disk = 'Unavailable';
    try { await fs.access(DATA_DIR, constants.R_OK | constants.W_OK); access = 'Readable and writable (access check only)'; } catch { /* Do not disclose paths or errors. */ }
    try { const stat = await fs.statfs(DATA_DIR); disk = `${(Number(stat.bavail) * Number(stat.bsize) / 1024 ** 3).toFixed(2)} GiB available`; } catch { /* not supported on all platforms */ }
    const ping = interaction.client.ws?.ping;
    const fields = [
      { name: 'Uptime', value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true },
      { name: 'Gateway latency', value: Number.isFinite(ping) && ping >= 0 ? `${ping} ms` : 'Unavailable', inline: true },
      { name: 'Process memory', value: `${(process.memoryUsage().rss / 1024 ** 2).toFixed(1)} MiB`, inline: true },
      { name: 'Data directory', value: access }, { name: 'Disk space', value: disk },
    ];
    return interaction.editReply({ embeds: [embeds.make(interaction, { title: '🩺 Bot Health', description: 'Local checks only; does not verify all Discord features, data integrity or successful writes.', fields })] });
  },
};
