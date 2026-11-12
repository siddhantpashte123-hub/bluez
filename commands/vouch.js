/**
 * /vouch give <stars> <review>   leave a review for the server / shop
 * /vouch stats                   number of vouches + average rating
 * /vouch channel <channel>       where vouches are posted (admins)
 *
 * Storage (data/vouches.json): { "<guildId>": { channelId, list: [{ userId, stars, text, at }] } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const COOLDOWN_MS = 60 * 60 * 1000;
const stars = (n) => '⭐'.repeat(n) + '▫️'.repeat(5 - n);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('⭐ Reviews / vouches.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('give').setDescription('⭐ Leave a review.')
        .addIntegerOption((o) => o.setName('stars').setDescription('1 to 5 stars').setRequired(true).setMinValue(1).setMaxValue(5))
        .addStringOption((o) => o.setName('review').setDescription('What did you buy / how was it?').setRequired(true).setMinLength(3).setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName('stats').setDescription('📊 Vouch count and average rating.'))
    .addSubcommand((s) =>
      s.setName('channel').setDescription('⚙️ Choose the vouch channel (admins).')
        .addChannelOption((o) => o.setName('channel').setDescription('Vouch channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    const store = db.guild('vouches', guild.id);
    const list = store.list ?? [];
    const canPost = (channel) => channel?.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);

    if (sub === 'channel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission for this.')));
      }
      const channel = interaction.options.getChannel('channel', true);
      if (!canPost(channel)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`)));
      db.updateGuild('vouches', guild.id, (v) => {
        v.channelId = channel.id;
        v.list ??= [];
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Vouch Channel Set', `Vouches will be posted in ${channel}.`)] });
    }

    if (sub === 'stats') {
      const average = list.length ? list.reduce((sum, v) => sum + v.stars, 0) / list.length : 0;
      const recent = list.slice(-3).reverse().map((v) => `${stars(v.stars)} <@${v.userId}> — ${v.text.slice(0, 120)}`);
      return interaction.reply({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.gold,
            title: `⭐ Vouches of ${guild.name}`,
            fields: [
              { name: '🧾 Total vouches', value: `**${list.length}**`, inline: true },
              { name: '📈 Average', value: list.length ? `**${average.toFixed(1)} / 5**` : '—', inline: true },
              ...(recent.length ? [{ name: '🕒 Latest', value: recent.join('\n') }] : []),
            ],
            thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
          }),
        ],
      });
    }

    // give
    const last = [...list].reverse().find((v) => v.userId === user.id);
    if (last && Date.now() - last.at < COOLDOWN_MS) {
      return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Slow Down', `You can vouch again <t:${Math.floor((last.at + COOLDOWN_MS) / 1000)}:R>.`)));
    }
    const rating = interaction.options.getInteger('stars', true);
    const text = interaction.options.getString('review', true).trim();
    const total = db.updateGuild('vouches', guild.id, (v) => {
      (v.list ??= []).push({ userId: user.id, stars: rating, text, at: Date.now() });
    }).list.length;

    const embed = embeds.make(interaction, {
      color: embeds.COLORS.gold,
      title: `${embeds.e('tick')} Vouch #${total}`,
      description: `${stars(rating)}\n${text}`,
      fields: [{ name: '👤 From', value: `${user}`, inline: true }, { name: '🧾 Total vouches', value: `${total}`, inline: true }],
      thumbnail: user.displayAvatarURL({ size: 256 }),
    });
    const channel = store.channelId ? await guild.channels.fetch(store.channelId).catch(() => null) : null;
    if (channel && canPost(channel) && channel.id !== interaction.channelId) {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Thank You!', `Your vouch was posted in ${channel}.`)));
    }
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
