/**
 * /announce <message> [title] [channel] [ping] [role] [image] [color]
 * Posts an announcement embed, optionally pinging @everyone, @here or a role.
 * Use \n in the message for a new line.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('📢 Post an announcement (with optional ping).')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('message').setDescription('Announcement text (use \\n for a new line)').setRequired(true).setMaxLength(3500))
    .addStringOption((o) => o.setName('title').setDescription('Title (default: Announcement)').setMaxLength(200))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName('ping').setDescription('Who to ping').addChoices({ name: 'Nobody', value: 'none' }, { name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }))
    .addRoleOption((o) => o.setName('role').setDescription('Ping this role'))
    .addStringOption((o) => o.setName('image').setDescription('Image link (https://...)').setMaxLength(500))
    .addStringOption((o) => o.setName('color').setDescription('Hex colour, e.g. #5865F2').setMaxLength(7)),

  async execute(interaction) {
    const { guild } = interaction;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const ping = interaction.options.getString('ping') ?? 'none';
    const role = interaction.options.getRole('role');
    const image = interaction.options.getString('image');
    const colorText = interaction.options.getString('color');
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    // Checked here too: prefix use and custom command permissions do not go through Discord's check.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return fail('Missing Permission', 'You need the **Manage Server** permission for this.');
    if (colorText && !/^#?[0-9a-f]{6}$/i.test(colorText)) return fail('Invalid Colour', 'Use a hex colour like `#5865F2`.');
    if (image && !/^https?:\/\/\S+$/i.test(image)) return fail('Invalid Image', 'The image must be a link starting with `https://`.');

    const me = guild.members.me;
    const perms = channel?.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return fail('I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel ?? 'that channel'}.`);
    }

    const wantsEveryone = ping !== 'none' || role?.id === guild.id;
    const needsMentionPerm = wantsEveryone || (role && !role.mentionable);
    if (needsMentionPerm && !perms.has(PermissionFlagsBits.MentionEveryone)) {
      return fail('I Cannot Ping That', `I need the **Mention @everyone, @here and All Roles** permission in ${channel} for this ping.`);
    }
    if (needsMentionPerm && !interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
      return fail('You Cannot Ping That', 'You need the **Mention @everyone, @here and All Roles** permission for this ping.');
    }

    const mentions = [];
    if (ping !== 'none') mentions.push(`@${ping}`);
    if (role) mentions.push(role.id === guild.id ? '@everyone' : `${role}`);

    const embed = embeds
      .make(interaction, {
        color: colorText ? parseInt(colorText.replace('#', ''), 16) : embeds.COLORS.blurple,
        title: `${embeds.e('boostShine')} ${interaction.options.getString('title') ?? 'Announcement'}`,
        description: interaction.options.getString('message', true).replace(/\\n/g, '\n'),
        image: image ?? undefined,
        thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
        footer: `Announced by ${interaction.user.username}`,
      })
      .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 64 }) ?? undefined });

    const sent = await channel.send({
      content: mentions.join(' ') || undefined,
      embeds: [embed],
      allowedMentions: { parse: wantsEveryone ? ['everyone'] : [], roles: role && role.id !== guild.id ? [role.id] : [] },
    });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Announcement Posted', `[Jump to the announcement](${sent.url}) in ${channel}.`)));
  },
};
