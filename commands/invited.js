/**
 * /invited @user
 * Shows how many members a user has invited and through which codes.
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const { syncInvites, storedInvites, totalOf } = require('./invites');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invited')
    .setDescription("🔗 Show a member's invite count and invite codes.")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('The member to look up').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    await interaction.reply({ embeds: [embeds.loading(interaction, `Looking up invites of ${user.username}...`)] });

    let data;
    let stale = false;
    try {
      data = await syncInvites(interaction.guild);
    } catch (err) {
      console.error('[/invited] sync failed:', err.message);
      data = storedInvites(interaction.guild.id);
      stale = true;
    }

    const entry = data[user.id];
    const total = totalOf(entry);
    const codes = Object.entries(entry?.codes ?? {}).sort((a, b) => b[1] - a[1]);

    const codeList = codes.length
      ? codes
          .slice(0, 15)
          .map(([code, uses]) => `🔗 \`${code}\` — **${uses}** use${uses === 1 ? '' : 's'}`)
          .join('\n') + (codes.length > 15 ? `\n*…and ${codes.length - 15} more*` : '')
      : '*No invite links found.*';

    await interaction.editReply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.cyan,
          title: `${embeds.e('gift')} Invites of ${user.username}`,
          description: `${user} has invited **${total}** member${total === 1 ? '' : 's'} to **${interaction.guild.name}**.`,
          fields: [
            { name: '👥 Total Invites', value: `${total}`, inline: true },
            { name: '🔢 Invite Links', value: `${codes.length}`, inline: true },
            { name: '🎟️ Invite Codes', value: codeList },
          ],
          thumbnail: user.displayAvatarURL({ size: 256 }),
          footer: stale ? 'Showing saved data (missing Manage Server permission)' : undefined,
        }),
      ],
    });
  },
};
