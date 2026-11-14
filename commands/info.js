/**
 * /info server | avatar [user] | ping | bot
 * (/userinfo has its own file.)
 */
const { SlashCommandBuilder, InteractionContextType, ChannelType, version: djsVersion } = require('discord.js');
const embeds = require('../utils/embeds');

function uptime(ms) {
  const s = Math.floor(ms / 1000);
  return [[Math.floor(s / 86400), 'd'], [Math.floor((s % 86400) / 3600), 'h'], [Math.floor((s % 3600) / 60), 'm'], [s % 60, 's']]
    .filter(([n], i) => n || i === 3)
    .map(([n, u]) => `${n}${u}`)
    .join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('ℹ️ Information commands.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('server').setDescription('🏠 Information about this server.'))
    .addSubcommand((s) => s.setName('avatar').setDescription('🖼️ Show the avatar of a member.').addUserOption((o) => o.setName('user').setDescription('Member (default: you)')))
    .addSubcommand((s) => s.setName('ping').setDescription('🏓 Check how fast the bot responds.'))
    .addSubcommand((s) => s.setName('bot').setDescription('🤖 Information about the bot.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, client } = interaction;

    if (sub === 'avatar') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const url = user.displayAvatarURL({ size: 1024 });
      return interaction.reply({
        embeds: [embeds.make(interaction, { color: embeds.COLORS.blurple, title: `🖼️ Avatar of ${user.username}`, description: `[Open in browser](${url})`, image: url, thumbnail: false })],
      });
    }

    if (sub === 'ping') {
      const started = Date.now();
      await interaction.reply({ embeds: [embeds.loading(interaction, 'Pinging...')] });
      return interaction.editReply({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.green,
            title: '🏓 Pong!',
            fields: [
              { name: '⚡ Response', value: `\`${Date.now() - started} ms\``, inline: true },
              { name: '💓 Discord gateway', value: client.ws.ping >= 0 ? `\`${Math.round(client.ws.ping)} ms\`` : '`measuring…`', inline: true },
            ],
          }),
        ],
      });
    }

    if (sub === 'bot') {
      return interaction.reply({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.blurple,
            title: `${embeds.e('bow')} ${client.user.username}`,
            fields: [
              { name: '🏠 Servers', value: `${client.guilds.cache.size}`, inline: true },
              { name: '🧩 Commands', value: `${client.commands?.size ?? 0}`, inline: true },
              { name: '⏱️ Uptime', value: uptime(client.uptime ?? 0), inline: true },
              { name: '💾 Memory', value: `${Math.round(process.memoryUsage().rss / 1048576)} MB`, inline: true },
              { name: '🟢 Node.js', value: process.version, inline: true },
              { name: '📚 discord.js', value: `v${djsVersion}`, inline: true },
            ],
          }),
        ],
      });
    }

    // server
    const channels = guild.channels.cache;
    const created = Math.floor(guild.createdTimestamp / 1000);
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.cyan,
          title: `🏠 ${guild.name}`,
          description: guild.description ?? undefined,
          fields: [
            { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
            { name: `${embeds.e('boostGem15')} Boosts`, value: `${guild.premiumSubscriptionCount ?? 0} (Level ${guild.premiumTier})`, inline: true },
            { name: '💬 Text channels', value: `${channels.filter((c) => c.type === ChannelType.GuildText).size}`, inline: true },
            { name: '🔊 Voice channels', value: `${channels.filter((c) => c.type === ChannelType.GuildVoice).size}`, inline: true },
            { name: '🎭 Roles', value: `${guild.roles.cache.size - 1}`, inline: true },
            { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
            { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
            { name: '📅 Created', value: `<t:${created}:D> (<t:${created}:R>)`, inline: true },
          ],
          thumbnail: guild.iconURL({ size: 512 }) ?? undefined,
          image: guild.bannerURL({ size: 1024 }) ?? undefined,
        }),
      ],
    });
  },
};
