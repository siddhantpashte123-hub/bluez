/**
 * /channel rename <new_name>
 * Renames the channel the command is used in.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');

// Discord allows only 2 renames per channel every 10 minutes. discord.js would
// silently wait for that limit, so we stop waiting after this many ms.
const RENAME_TIMEOUT_MS = 10_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('📁 Channel tools.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('✏️ Rename the current channel.')
        .addStringOption((o) => o.setName('new_name').setDescription('The new channel name').setRequired(true).setMinLength(1).setMaxLength(100)),
    ),

  async execute(interaction) {
    const newName = interaction.options.getString('new_name', true).trim();
    const { channel } = interaction;

    await interaction.reply({ embeds: [embeds.loading(interaction, 'Renaming channel...')] });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'Missing Permission', 'You need the **Manage Channels** permission to use this command.')],
      });
    }
    if (!channel || typeof channel.setName !== 'function' || !interaction.appPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'I Cannot Rename This Channel', 'I need the **Manage Channels** permission in this channel.')],
      });
    }

    const oldName = channel.name;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), RENAME_TIMEOUT_MS);
    });
    const rename = channel.setName(newName, `Renamed by ${interaction.user.tag}`);
    rename.catch(() => {}); // handled below; avoids an unhandled rejection after a timeout

    const result = await Promise.race([rename, timeout]);
    clearTimeout(timer);

    if (result === 'timeout') {
      return interaction.editReply({
        embeds: [
          embeds.warn(
            interaction,
            'Rename Is Rate Limited',
            'Discord only allows **2 renames per channel every 10 minutes**.\nYour rename is queued and will be applied automatically once the limit resets.',
          ),
        ],
      });
    }

    await interaction.editReply({
      embeds: [
        embeds.success(interaction, 'Channel Renamed', `This channel is now called ${channel}.`, {
          fields: [
            { name: '📛 Before', value: `\`${oldName}\``, inline: true },
            { name: '✨ After', value: `\`${result.name}\``, inline: true },
            { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
          ],
        }),
      ],
    });
  },
};
