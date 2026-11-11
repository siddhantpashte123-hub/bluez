/**
 * Ticket system
 * ---------------------------------------------------------------
 * /ticket setup [channel] [category] [support_role] [title] [description]
 *        Posts the ticket panel (embed + "Create Ticket" button).
 * /ticket close            Close the ticket channel you are in.
 * /ticket add <user>       Give a member access to this ticket.
 * /ticket remove <user>    Take a member's access away again.
 *
 * Buttons use fixed custom IDs ("ticket_...") and are handled through
 * events/interactionCreate.js -> handleButton(), so the panel keeps
 * working after a bot restart (no collectors involved).
 *
 * Storage (data/tickets.json):
 *   { "<guildId>": {
 *       "categoryId": "..." | null,
 *       "supportRoleId": "..." | null,
 *       "counter": 12,
 *       "tickets": { "<channelId>": { "userId": "...", "number": 12, "openedAt": 1700000000000 } }
 *   } }
 *
 * The bot needs: Manage Channels + Manage Roles (to set who can see
 * a ticket), View Channel, Send Messages, Embed Links.
 */
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const CLOSE_DELAY_MS = 5000;
const MAX_CHANNELS_PER_CATEGORY = 50; // Discord limit

/** What a ticket member (opener, support role, added user) may do. */
const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
/** What the bot itself needs inside a ticket channel. */
const BOT_PERMS = [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const configOf = (guildId) => db.get('tickets')[guildId] ?? null;
const ticketOf = (guildId, channelId) => configOf(guildId)?.tickets?.[channelId] ?? null;
const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

/** "Sid Pashte#1" -> "sid-pashte1" (valid channel name part). */
function slug(text) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'user'
  );
}

/** Is this member staff for tickets? (support role or Manage Channels) */
function isStaff(member, config, ticket = null) {
  if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  if (ticket?.hostId && member.id === ticket.hostId) return true; // giveaway host of a prize ticket
  return Boolean(config?.supportRoleId && member.roles?.cache?.has(config.supportRoleId));
}

/** Buttons shown inside a ticket channel. */
function closeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

/** Confirm / cancel row. */
function confirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Yes, close it').setEmoji(embeds.e('tick')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/** Ask "are you sure?" before closing (used by the button and by /ticket close). */
async function askToClose(interaction) {
  const ticket = ticketOf(interaction.guildId, interaction.channelId);
  if (!ticket) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Not a Ticket', 'This command only works inside a ticket channel.')));
  }
  const config = configOf(interaction.guildId);
  if (interaction.user.id !== ticket.userId && !isStaff(interaction.member, config, ticket)) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Not Allowed', 'Only the ticket owner or the support team can close this ticket.')));
  }
  return interaction.reply({
    embeds: [embeds.warn(interaction, 'Close This Ticket?', 'The channel and all of its messages will be **deleted**.')],
    components: [confirmRow()],
  });
}

/* ------------------------------------------------------------------ */
/*  Button: create a ticket                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a ticket channel for the member who pressed a button.
 * `prize` is set when a giveaway winner claims a prize (see commands/gcreate.js):
 *   { prize: 'Nitro', hostId: '123' }  -> works without /ticket setup, the host is added
 *   to the ticket, and it does not count towards the "one ticket per member" rule.
 * Returns the new channel, or null when no ticket was created (the user was told why).
 */
async function openTicket(interaction, prize = null) {
  const { guild, user } = interaction;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = configOf(guild.id) ?? (prize ? { counter: 0, tickets: {} } : null);
  if (!config) {
    await interaction.editReply({
      embeds: [embeds.error(interaction, 'Tickets Are Not Set Up', 'An admin has to run `/ticket setup` first.')],
    });
    return null;
  }

  // One open support ticket per member (ignore records whose channel was deleted by hand).
  const existing = prize ? null : Object.entries(config.tickets ?? {}).find(([, t]) => t.userId === user.id && !t.prize);
  if (existing) {
    const stillThere = await guild.channels.fetch(existing[0]).catch(() => null);
    if (stillThere) {
      await interaction.editReply({
        embeds: [embeds.warn(interaction, 'You Already Have a Ticket', `Please use your open ticket: ${stillThere}`)],
      });
      return null;
    }
    db.update('tickets', (data) => {
      delete data[guild.id].tickets[existing[0]];
    });
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    await interaction.editReply({
      embeds: [
        embeds.error(interaction, 'I Am Missing Permissions', 'I need the **Manage Channels** and **Manage Roles** permissions to create ticket channels. Please tell an admin.'),
      ],
    });
    return null;
  }

  // Use the configured category if it still exists and has room.
  let parent = null;
  if (config.categoryId) {
    const category = await guild.channels.fetch(config.categoryId).catch(() => null);
    if (category?.type === ChannelType.GuildCategory && category.children.cache.size < MAX_CHANNELS_PER_CATEGORY) parent = category.id;
  }
  const supportRole = config.supportRoleId ? await guild.roles.fetch(config.supportRoleId).catch(() => null) : null;

  const number = (config.counter ?? 0) + 1;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: MEMBER_PERMS },
    { id: me.id, allow: BOT_PERMS },
  ];
  if (supportRole) overwrites.push({ id: supportRole.id, allow: MEMBER_PERMS });
  // Prize tickets: the giveaway host can always see the ticket.
  const host = prize?.hostId && prize.hostId !== user.id ? await guild.members.fetch(prize.hostId).catch(() => null) : null;
  if (host) overwrites.push({ id: host.id, allow: MEMBER_PERMS });

  let channel;
  try {
    channel = await guild.channels.create({
      name: `${prize ? 'prize' : 'ticket'}-${slug(user.username)}-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent,
      topic: `${prize ? `Prize claim: ${prize.prize.slice(0, 100)}` : `Ticket #${number}`} • opened by ${user.tag} (${user.id})`,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${user.tag}`,
    });
  } catch (err) {
    console.error('[Ticket] create failed:', err.code ?? '', err.message);
    await interaction.editReply({
      embeds: [
        embeds.error(
          interaction,
          'Could Not Create the Ticket',
          err.code === 50013
            ? 'I am missing permissions. Give me **Manage Channels** and **Manage Roles**, and make sure I can see the ticket category.'
            : 'Discord refused to create the channel. Please try again in a moment.',
        ),
      ],
    });
    return null;
  }

  db.update('tickets', (data) => {
    const g = (data[guild.id] ??= { counter: 0, tickets: {} });
    g.counter = number;
    (g.tickets ??= {})[channel.id] = { userId: user.id, number, openedAt: Date.now(), ...(prize ? { prize: prize.prize, hostId: host?.id ?? null } : {}) };
  });

  // Welcome message inside the ticket (pings the opener and the support role once).
  await channel
    .send({
      content: `${user}${host ? ` ${host}` : ''}${supportRole ? ` ${supportRole}` : ''}`,
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.blurple,
          title: prize ? `${embeds.e('giftLegend')} Prize Claim` : `${embeds.e('gift')} Ticket #${number}`,
          description: prize
            ? `Congratulations ${user}! ${embeds.e('bow')}\nYou won **${prize.prize}**. The host will hand over your prize here.`
            : `Welcome ${user}! ${embeds.e('bow')}\n` + 'Please describe what you need and the support team will be with you shortly.',
          fields: [
            { name: prize ? '🏆 Winner' : '👤 Opened by', value: `${user}`, inline: true },
            prize
              ? { name: '🎙️ Giveaway Host', value: host ? `${host}` : 'Server staff', inline: true }
              : { name: '🛟 Support', value: supportRole ? `${supportRole}` : 'Server staff', inline: true },
            { name: '🔒 Closing', value: 'Press the button below or use `/ticket close`.' },
          ],
          thumbnail: user.displayAvatarURL({ size: 256 }),
        }),
      ],
      components: [closeRow()],
      allowedMentions: { users: host ? [user.id, host.id] : [user.id], roles: supportRole ? [supportRole.id] : [] },
    })
    .catch((err) => console.error('[Ticket] welcome message failed:', err.message));

  await interaction.editReply({
    embeds: [embeds.success(interaction, 'Ticket Created', `Your ticket is ready: ${channel}`)],
  });
  return channel;
}

/* ------------------------------------------------------------------ */
/*  Button: confirm close                                              */
/* ------------------------------------------------------------------ */

async function confirmClose(interaction) {
  const { guild, channel } = interaction;
  const ticket = ticketOf(guild.id, channel.id);
  if (!ticket) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Not a Ticket', 'This channel is not an open ticket.')));
  }
  if (interaction.user.id !== ticket.userId && !isStaff(interaction.member, configOf(guild.id), ticket)) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Not Allowed', 'Only the ticket owner or the support team can close this ticket.')));
  }

  await interaction.update({
    embeds: [
      embeds.make(interaction, {
        color: embeds.COLORS.pink,
        title: '🔒 Ticket Closed',
        description: `Closed by ${interaction.user}.\nThis channel will be deleted in **${CLOSE_DELAY_MS / 1000} seconds**.`,
      }),
    ],
    components: [],
  });

  db.update('tickets', (data) => {
    delete data[guild.id]?.tickets?.[channel.id];
  });

  setTimeout(() => {
    channel.delete(`Ticket closed by ${interaction.user.tag}`).catch((err) => console.error('[Ticket] delete failed:', err.message));
  }, CLOSE_DELAY_MS);
}

/** Router for every "ticket_*" button (called from events/interactionCreate.js). */
async function handleButton(interaction) {
  switch (interaction.customId) {
    case 'ticket_open':
      return openTicket(interaction);
    case 'ticket_close':
      return askToClose(interaction);
    case 'ticket_close_confirm':
      return confirmClose(interaction);
    case 'ticket_close_cancel':
      return interaction.update({
        embeds: [embeds.info(interaction, `${embeds.e('tick')} Cancelled`, 'The ticket stays open.', { color: embeds.COLORS.green })],
        components: [],
      });
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  Slash command                                                      */
/* ------------------------------------------------------------------ */

module.exports = {
  handleButton,
  openTicket,

  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('🎫 Ticket system.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('🎫 Post the ticket panel with the "Create Ticket" button (admins).')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to post the panel (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o.setName('category').setDescription('Category in which ticket channels are created').addChannelTypes(ChannelType.GuildCategory),
        )
        .addRoleOption((o) => o.setName('support_role').setDescription('Role that can see and answer every ticket'))
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(200))
        .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(1500)),
    )
    .addSubcommand((sub) => sub.setName('close').setDescription('🔒 Close the ticket you are in.'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('➕ Add a member to this ticket.')
        .addUserOption((o) => o.setName('user').setDescription('Member to add').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('➖ Remove a member from this ticket.')
        .addUserOption((o) => o.setName('user').setDescription('Member to remove').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    /* ---------- /ticket setup ---------- */
    if (sub === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission to set up tickets.')));
      }
      await interaction.reply(ephemeral(embeds.loading(interaction, 'Setting up the ticket panel...')));

      const target = interaction.options.getChannel('channel') ?? interaction.channel;
      const category = interaction.options.getChannel('category');
      const role = interaction.options.getRole('support_role');
      const title = interaction.options.getString('title') ?? 'Support Tickets';
      const text =
        interaction.options.getString('description') ??
        'Need help, want to buy something, or have a question?\nPress the button below to open a **private ticket** with the team.';

      const me = guild.members.me ?? (await guild.members.fetchMe());
      const here = target?.permissionsFor?.(me);
      if (!here?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.editReply({
          embeds: [embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${target ?? 'that channel'}.`)],
        });
      }
      const missing = [];
      if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Manage Channels');
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('Manage Roles');
      if (missing.length) {
        return interaction.editReply({
          embeds: [embeds.error(interaction, 'I Am Missing Permissions', `Ticket channels cannot be created without: **${missing.join('**, **')}**.\nGive my role these permissions and run \`/ticket setup\` again.`)],
        });
      }

      // Save the config (existing open tickets and the counter are kept).
      db.update('tickets', (data) => {
        const g = (data[guild.id] ??= { counter: 0, tickets: {} });
        g.categoryId = category?.id ?? null;
        g.supportRoleId = role?.id ?? null;
        g.tickets ??= {};
      });

      await target.send({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.blurple,
            title: `${embeds.e('gift')} ${title}`,
            description: `${text}\n\n${embeds.e('tick')} One ticket per member\n${embeds.e('caution')} Please do not open tickets without a reason`,
            thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_open').setLabel('Create Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
          ),
        ],
      });

      return interaction.editReply({
        embeds: [
          embeds.success(interaction, 'Ticket Panel Posted', `Members can now open tickets in ${target}.`, {
            fields: [
              { name: '📁 Category', value: category ? `${category}` : 'None (top of the channel list)', inline: true },
              { name: '🛟 Support Role', value: role ? `${role}` : 'None (staff with Manage Channels)', inline: true },
            ],
          }),
        ],
      });
    }

    /* ---------- /ticket close ---------- */
    if (sub === 'close') return askToClose(interaction);

    /* ---------- /ticket add | remove ---------- */
    const ticket = ticketOf(guild.id, interaction.channelId);
    if (!ticket) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Not a Ticket', 'This command only works inside a ticket channel.')));
    }
    if (!isStaff(interaction.member, configOf(guild.id), ticket)) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Not Allowed', 'Only the support team can add or remove members.')));
    }

    const user = interaction.options.getUser('user', true);
    if (sub === 'add') {
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Member Added', `${user} can now see this ticket.`)] });
    }

    if (user.id === ticket.userId) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Cannot Remove the Owner', 'The member who opened the ticket cannot be removed. Close the ticket instead.')));
    }
    await interaction.channel.permissionOverwrites.delete(user.id);
    return interaction.reply({ embeds: [embeds.success(interaction, 'Member Removed', `${user} can no longer see this ticket.`)] });
  },
};
