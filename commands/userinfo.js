/**
 * /userinfo [user]
 * Shows profile details of a member (or of yourself).
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');

/** Discord timestamp: "12 March 2024 (2 years ago)" */
const when = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:D>\n<t:${Math.floor(ms / 1000)}:R>` : 'Unknown');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('🪪 Show information about a member.')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('The member to look up (default: you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    await interaction.reply({ embeds: [embeds.loading(interaction, `Loading profile of ${user.username}...`)] });

    // The user may not be in this server (e.g. looked up by ID) -> member stays null.
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const roles = member
      ? member.roles.cache
          .filter((role) => role.id !== interaction.guild.id) // hide @everyone
          .sort((a, b) => b.position - a.position)
          .map((role) => `${role}`)
      : [];
    const roleText = roles.length
      ? roles.slice(0, 15).join(' ') + (roles.length > 15 ? ` *+${roles.length - 15} more*` : '')
      : '*None*';

    const tags = [
      user.bot && '🤖 Bot',
      member && interaction.guild.ownerId === user.id && '👑 Server Owner',
      member?.premiumSince && '💎 Server Booster',
      member?.isCommunicationDisabled?.() && '🔇 Timed Out',
    ].filter(Boolean);

    await interaction.editReply({
      embeds: [
        embeds.make(interaction, {
          color: member?.displayColor || embeds.COLORS.blurple,
          title: `${embeds.e('bow')} ${member?.displayName ?? user.username}`,
          description: `${user}${tags.length ? `\n${tags.join(' • ')}` : ''}`,
          fields: [
            { name: '👤 Username', value: `\`${user.tag}\``, inline: true },
            { name: '🆔 User ID', value: `\`${user.id}\``, inline: true },
            { name: '📛 Nickname', value: member?.nickname ?? '*None*', inline: true },
            { name: '📅 Account Created', value: when(user.createdTimestamp), inline: true },
            { name: '📥 Joined Server', value: member ? when(member.joinedTimestamp) : '*Not in this server*', inline: true },
            { name: '🏅 Highest Role', value: member && roles.length ? roles[0] : '*None*', inline: true },
            { name: `🎭 Roles (${roles.length})`, value: roleText.slice(0, 1024) },
          ],
          thumbnail: (member ?? user).displayAvatarURL({ size: 512 }),
        }),
      ],
    });
  },
};
