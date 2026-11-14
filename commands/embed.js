/**
 * /embed <title> <description> [color] [image] [thumbnail] [footer] [channel]
 * Sends a custom embed / announcement as the bot.
 * Use \n in the description for a new line.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, EmbedBuilder } = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('📝 Send a custom embed / announcement.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256))
    .addStringOption((o) => o.setName('description').setDescription('Embed text (use \\n for a new line)').setRequired(true).setMaxLength(3500))
    .addStringOption((o) => o.setName('color').setDescription('Hex colour, e.g. #5865F2').setMaxLength(7))
    .addStringOption((o) => o.setName('image').setDescription('Image link (https://...)').setMaxLength(500))
    .addStringOption((o) => o.setName('thumbnail').setDescription('Small image link in the corner (https://...)').setMaxLength(500))
    .addStringOption((o) => o.setName('footer').setDescription('Footer text (default: server name)').setMaxLength(200))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to send it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const colorText = interaction.options.getString('color');
    const image = interaction.options.getString('image');
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    if (colorText && !/^#?[0-9a-f]{6}$/i.test(colorText)) return fail('Invalid Colour', 'Use a hex colour like `#5865F2`.');
    if (image && !/^https?:\/\/\S+$/i.test(image)) return fail('Invalid Image', 'The image must be a link starting with `https://`.');
    const thumbnail = interaction.options.getString('thumbnail');
    if (thumbnail && !/^https?:\/\/\S+$/i.test(thumbnail)) return fail('Invalid Thumbnail', 'The thumbnail must be a link starting with `https://`.');
    // Checked here too, so the prefix version (!embed) is just as safe.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return fail('Missing Permission', 'You need the **Manage Messages** permission for this.');
    if (!channel?.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return fail('I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel ?? 'that channel'}.`);
    }

    const embed = new EmbedBuilder()
      .setColor(colorText ? parseInt(colorText.replace('#', ''), 16) : embeds.COLORS.blurple)
      .setTitle(interaction.options.getString('title', true))
      .setDescription(interaction.options.getString('description', true).replace(/\\n/g, '\n'))
      .setFooter({ text: interaction.options.getString('footer') ?? interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined })
      .setTimestamp();
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);

    // No pings from custom embeds (prevents @everyone abuse).
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Embed Sent', `Your embed was posted in ${channel}.`)));
  },
};
