/**
 * Welcome system
 * ---------------------------------------------------------------
 * /welcome set <channel> [message]       welcome new members
 * /welcome goodbye <channel> [message]   say goodbye when someone leaves
 * /welcome autorole [role]               give a role on join (no role = off)
 * /welcome off <what>                    turn welcome / goodbye off
 * /welcome test                          preview with yourself
 *
 * Placeholders in messages: {user} {username} {server} {count}
 * The sending happens in events/guildMemberAdd.js and guildMemberRemove.js.
 *
 * Storage (data/settings.json):
 *   { "<guildId>": { welcome: { channelId, message }, goodbye: { channelId, message }, autoRoleId } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const DEFAULT_WELCOME = 'Welcome {user} to **{server}**! You are member **#{count}**.';
const DEFAULT_GOODBYE = '**{username}** left the server. We are now **{count}** members.';

/** Replace {user}, {username}, {server}, {count}. */
function fill(template, member) {
  return template
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', `${member.guild.memberCount}`)
    .replace(/\\n/g, '\n');
}

/** Build the welcome message payload. `inviterId` is optional. */
function welcomePayload(member, config, inviterId = null) {
  const created = Math.floor(member.user.createdTimestamp / 1000);
  const fields = [
    { name: '📅 Account created', value: `<t:${created}:R>`, inline: true },
    { name: '👥 Members', value: `${member.guild.memberCount}`, inline: true },
  ];
  if (inviterId) fields.push({ name: '📨 Invited by', value: `<@${inviterId}>`, inline: true });
  return {
    content: `${member}`,
    embeds: [
      embeds.make(member, {
        color: embeds.COLORS.green,
        title: `${embeds.e('bow')} Welcome!`,
        description: fill(config.message || DEFAULT_WELCOME, member),
        fields,
        thumbnail: member.user.displayAvatarURL({ size: 512 }),
      }),
    ],
    allowedMentions: { users: [member.id] },
  };
}

/** Build the goodbye message payload. */
function goodbyePayload(member, config) {
  return {
    embeds: [
      embeds.make(member, {
        color: embeds.COLORS.pink,
        title: '👋 Goodbye',
        description: fill(config.message || DEFAULT_GOODBYE, member),
        thumbnail: member.user.displayAvatarURL({ size: 512 }),
      }),
    ],
    allowedMentions: { parse: [] },
  };
}

const channelOpt = (o) => o.setName('channel').setDescription('Channel for the messages').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true);
const messageOpt = (o) => o.setName('message').setDescription('Custom text. Placeholders: {user} {username} {server} {count}').setMaxLength(1000);

module.exports = {
  welcomePayload,
  goodbyePayload,

  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('👋 Welcome / goodbye messages and auto-role.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('set').setDescription('👋 Welcome new members in a channel.').addChannelOption(channelOpt).addStringOption(messageOpt))
    .addSubcommand((s) => s.setName('goodbye').setDescription('🚪 Post a message when someone leaves.').addChannelOption(channelOpt).addStringOption(messageOpt))
    .addSubcommand((s) => s.setName('autorole').setDescription('🎭 Give every new member a role (leave empty to turn off).').addRoleOption((o) => o.setName('role').setDescription('Role to give')))
    .addSubcommand((s) =>
      s.setName('off').setDescription('🚫 Turn welcome or goodbye messages off.')
        .addStringOption((o) => o.setName('what').setDescription('What to turn off').setRequired(true).addChoices({ name: 'Welcome messages', value: 'welcome' }, { name: 'Goodbye messages', value: 'goodbye' })),
    )
    .addSubcommand((s) => s.setName('test').setDescription('🧪 Preview the welcome message with yourself.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const me = guild.members.me;

    if (sub === 'set' || sub === 'goodbye') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message');
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`)));
      }
      const key = sub === 'set' ? 'welcome' : 'goodbye';
      db.updateGuild('settings', guild.id, (s) => {
        s[key] = { channelId: channel.id, message: message ?? null };
      });
      return interaction.reply({
        embeds: [
          embeds.success(interaction, key === 'welcome' ? 'Welcome Messages Enabled' : 'Goodbye Messages Enabled', `Messages will be posted in ${channel}.`, {
            fields: [{ name: '📝 Text', value: (message ?? (key === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE)).slice(0, 1000) }],
            footer: key === 'welcome' ? 'Preview it with /welcome test' : undefined,
          }),
        ],
      });
    }

    if (sub === 'autorole') {
      const role = interaction.options.getRole('role');
      if (!role) {
        db.updateGuild('settings', guild.id, (s) => {
          delete s.autoRoleId;
        });
        return interaction.reply({ embeds: [embeds.success(interaction, 'Auto-Role Disabled', 'New members will not get a role automatically.')] });
      }
      if (role.managed || role.id === guild.id) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Role', 'That role cannot be given to members.')));
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Give That Role', 'I need **Manage Roles**, and my role must be **above** that role in the role list.')));
      }
      db.updateGuild('settings', guild.id, (s) => {
        s.autoRoleId = role.id;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Auto-Role Enabled', `Every new member will get ${role}.`)] });
    }

    if (sub === 'off') {
      const what = interaction.options.getString('what', true);
      db.updateGuild('settings', guild.id, (s) => {
        delete s[what];
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Turned Off', `${what === 'welcome' ? 'Welcome' : 'Goodbye'} messages are now off.`)] });
    }

    // test
    const config = db.guild('settings', guild.id).welcome;
    if (!config) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Not Set Up', 'Run `/welcome set` first.')));
    return interaction.reply({ ...welcomePayload(interaction.member, config, interaction.user.id), flags: 64 });
  },
};
