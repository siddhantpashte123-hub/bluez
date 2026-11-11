/**
 * Giveaway system
 * ---------------------------------------------------------------
 * /gcreate <prize> <duration> [winners] [channel]   start a giveaway
 * /gend [message_id]                                end one right now      (commands/gend.js)
 * /greroll [message_id] [winners]                   pick new winner(s)     (commands/greroll.js)
 *
 * Members join with the button under the giveaway message (press it
 * again to leave). When it ends, the winner announcement gets a
 * "Claim Prize" button that ONLY the winner(s) can use; it opens a
 * private ticket with the giveaway host (see commands/ticket.js). The button uses a fixed custom ID and is handled
 * through events/interactionCreate.js, and the end time is checked by
 * a timer started in events/ready.js – so giveaways survive restarts.
 *
 * Storage (data/giveaways.json):
 *   { "<messageId>": { guildId, channelId, prize, winners, hostId,
 *                      endsAt, entrants: [userId], ended, winnerIds: [userId] } }
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
const tickets = require('./ticket');

const MIN_DURATION_MS = 10_000; // 10 seconds
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const KEEP_ENDED_MS = 7 * 24 * 60 * 60 * 1000; // ended giveaways stay rerollable for 7 days
const COUNT_REFRESH_MS = 5000; // how often the "Entries" number on the message is refreshed

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** messageId -> pending "refresh entry count" timer */
const refreshTimers = new Map();
/** messageIds that are being ended right now (prevents double endings) */
const ending = new Set();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** "1d 12h", "30m", "45s", "2h30m" -> milliseconds (null when invalid). */
function parseDuration(input) {
  const text = String(input).toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(text)) return null;
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(amount) * UNIT_MS[unit];
  return total;
}

/** Pick `count` different random entries. */
function pickWinners(entrants, count) {
  const pool = [...entrants];
  const winners = [];
  while (pool.length && winners.length < count) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}

const mentions = (ids) => ids.map((id) => `<@${id}>`).join(', ');
const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

/** The embed shown on the giveaway message. */
function giveawayEmbed(ctx, g) {
  const ends = Math.floor(g.endsAt / 1000);
  if (!g.ended) {
    return embeds.make(ctx, {
      color: embeds.COLORS.blurple,
      title: `${embeds.e('giftLegend')} GIVEAWAY ${embeds.e('giftLegend')}`,
      description: `### ${embeds.e('gift')} ${g.prize}\nPress the button below to enter! ${embeds.e('bow')}`,
      fields: [
        { name: '⏰ Ends', value: `<t:${ends}:R>\n<t:${ends}:f>`, inline: true },
        { name: '🏆 Winners', value: `${g.winners}`, inline: true },
        { name: '👥 Entries', value: `${g.entrants.length}`, inline: true },
        { name: '🎙️ Hosted by', value: `<@${g.hostId}>`, inline: true },
      ],
    });
  }
  return embeds.make(ctx, {
    color: embeds.COLORS.pink,
    title: `${embeds.e('gift')} GIVEAWAY ENDED`,
    description: `### ${embeds.e('gift')} ${g.prize}`,
    fields: [
      { name: '🏆 Winner(s)', value: g.winnerIds.length ? mentions(g.winnerIds) : '*Nobody entered*' },
      { name: '👥 Entries', value: `${g.entrants.length}`, inline: true },
      { name: '🎙️ Hosted by', value: `<@${g.hostId}>`, inline: true },
      { name: '⏰ Ended', value: `<t:${ends}:R>`, inline: true },
    ],
  });
}

/** The join button. */
function enterRow(g) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway_enter')
      .setLabel(g.ended ? 'Giveaway Ended' : 'Enter Giveaway')
      .setEmoji(embeds.e('gift'))
      .setStyle(g.ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(g.ended),
  );
}

/** "Claim Prize" button under the winner announcement (only winners can use it). */
function claimRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_claim_${messageId}`).setLabel('Claim Prize (Open Ticket)').setEmoji('🎫').setStyle(ButtonStyle.Success),
  );
}

/** Fetch the giveaway message (null if the channel/message is gone). */
async function fetchMessage(client, g, messageId) {
  try {
    const channel = await client.channels.fetch(g.channelId);
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

/**
 * Find a giveaway for /gend and /greroll.
 * With an ID: exactly that one. Without: the newest matching one in this channel.
 */
function findGiveaway(interaction, messageId, wantEnded) {
  const all = db.get('giveaways');
  if (messageId) {
    const id = messageId.trim().split(/[/-]/).pop(); // also accepts a message link
    const g = all[id];
    return g && g.guildId === interaction.guildId ? [id, g] : null;
  }
  return (
    Object.entries(all)
      .filter(([, g]) => g.guildId === interaction.guildId && g.channelId === interaction.channelId && g.ended === wantEnded)
      .sort((a, b) => b[1].endsAt - a[1].endsAt)[0] ?? null
  );
}

/* ------------------------------------------------------------------ */
/*  Ending / rerolling                                                 */
/* ------------------------------------------------------------------ */

/** End a giveaway: pick winners, update the message, announce. */
async function endGiveaway(client, messageId) {
  if (ending.has(messageId)) return null;
  const g = db.get('giveaways')[messageId];
  if (!g || g.ended) return null;

  ending.add(messageId);
  try {
    clearTimeout(refreshTimers.get(messageId));
    refreshTimers.delete(messageId);

    const winnerIds = pickWinners(g.entrants, g.winners);
    db.update('giveaways', (data) => {
      Object.assign(data[messageId], { ended: true, winnerIds, endsAt: Math.min(g.endsAt, Date.now()) });
    });
    const updated = db.get('giveaways')[messageId];

    const message = await fetchMessage(client, updated, messageId);
    if (!message) return updated; // message or channel was deleted – nothing to announce

    await message.edit({ embeds: [giveawayEmbed(client, updated)], components: [enterRow(updated)] }).catch(() => {});
    await message
      .reply({
        content: winnerIds.length ? mentions(winnerIds) : undefined,
        embeds: [
          winnerIds.length
            ? embeds.make(client, {
                color: embeds.COLORS.green,
                title: `${embeds.e('giftLegend')} Congratulations!`,
                description: `${mentions(winnerIds)} won **${updated.prize}**! ${embeds.e('bow')}\nPress the button below to open a private ticket and claim your prize.`,
              })
            : embeds.warn(client, 'No Winner', `Nobody entered the giveaway for **${updated.prize}**.`),
        ],
        components: winnerIds.length ? [claimRow(messageId)] : [],
        allowedMentions: { users: winnerIds },
      })
      .catch((err) => console.error('[Giveaway] announce failed:', err.message));
    return updated;
  } finally {
    ending.delete(messageId);
  }
}

/** Pick new winner(s) for an ended giveaway. Returns the new winner IDs. */
async function rerollGiveaway(client, messageId, count) {
  const g = db.get('giveaways')[messageId];
  if (!g?.ended) return null;

  // Prefer people who have not won yet; fall back to everyone if too few are left.
  const fresh = g.entrants.filter((id) => !g.winnerIds.includes(id));
  const winnerIds = pickWinners(fresh.length >= count ? fresh : g.entrants, count);
  if (!winnerIds.length) return [];

  db.update('giveaways', (data) => {
    data[messageId].winnerIds = winnerIds;
  });
  const message = await fetchMessage(client, g, messageId);
  await message?.edit({ embeds: [giveawayEmbed(client, db.get('giveaways')[messageId])] }).catch(() => {});
  return winnerIds;
}

/**
 * Called every few seconds from events/ready.js:
 * ends every giveaway whose time is up and forgets very old ones.
 */
async function tick(client) {
  const now = Date.now();
  const all = db.get('giveaways');
  for (const [messageId, g] of Object.entries(all)) {
    if (!g.ended && g.endsAt <= now) {
      await endGiveaway(client, messageId).catch((err) => console.error('[Giveaway] end failed:', err.message));
    }
  }
  const stale = Object.entries(all).filter(([, g]) => g.ended && now - g.endsAt > KEEP_ENDED_MS);
  if (stale.length) {
    db.update('giveaways', (data) => {
      for (const [id] of stale) delete data[id];
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Button: enter / leave                                              */
/* ------------------------------------------------------------------ */

/** Winner pressed "Claim Prize": open a private ticket with the giveaway host. */
async function handleClaim(interaction) {
  const messageId = interaction.customId.slice('giveaway_claim_'.length);
  const g = db.get('giveaways')[messageId];
  const userId = interaction.user.id;

  if (!g?.ended) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Giveaway Not Found', 'This giveaway is too old or no longer exists.')));
  }
  // Only the current winner(s) may claim.
  if (!g.winnerIds.includes(userId)) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Winners Only', `Only the winner of **${g.prize}** can open this ticket.`)));
  }
  // One claim ticket per winner.
  const claimedChannelId = g.claimed?.[userId];
  if (claimedChannelId) {
    const channel = await interaction.guild.channels.fetch(claimedChannelId).catch(() => null);
    return interaction.reply(
      ephemeral(
        channel
          ? embeds.warn(interaction, 'Already Claimed', `Your prize ticket is here: ${channel}`)
          : embeds.warn(interaction, 'Already Claimed', `You already opened a ticket for this prize. Contact <@${g.hostId}> if you still need help.`),
      ),
    );
  }

  const channel = await tickets.openTicket(interaction, { prize: g.prize, hostId: g.hostId });
  if (channel) {
    db.update('giveaways', (data) => {
      (data[messageId].claimed ??= {})[userId] = channel.id;
    });
  }
  return undefined;
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith('giveaway_claim_')) return handleClaim(interaction);
  if (interaction.customId !== 'giveaway_enter') return;
  const messageId = interaction.message.id;
  const g = db.get('giveaways')[messageId];

  if (!g || g.ended || g.endsAt <= Date.now()) {
    return interaction.reply(ephemeral(embeds.error(interaction, 'Giveaway Ended', 'This giveaway is already over.')));
  }

  const userId = interaction.user.id;
  const joined = !g.entrants.includes(userId);
  db.update('giveaways', (data) => {
    const list = data[messageId].entrants;
    if (joined) list.push(userId);
    else list.splice(list.indexOf(userId), 1);
  });

  // Refresh the "Entries" number at most once every few seconds (rate-limit friendly).
  if (!refreshTimers.has(messageId)) {
    refreshTimers.set(
      messageId,
      setTimeout(() => {
        refreshTimers.delete(messageId);
        const current = db.get('giveaways')[messageId];
        if (current && !current.ended) interaction.message.edit({ embeds: [giveawayEmbed(interaction, current)] }).catch(() => {});
      }, COUNT_REFRESH_MS),
    );
  }

  return interaction.reply(
    ephemeral(
      joined
        ? embeds.success(interaction, 'You Are In!', `You entered the giveaway for **${g.prize}**. Good luck! ${embeds.e('bow')}\nPress the button again to leave.`)
        : embeds.warn(interaction, 'Entry Removed', `You left the giveaway for **${g.prize}**.`),
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  /gcreate                                                           */
/* ------------------------------------------------------------------ */

module.exports = {
  handleButton,
  claimRow,
  tick,
  endGiveaway,
  rerollGiveaway,
  findGiveaway,

  data: new SlashCommandBuilder()
    .setName('gcreate')
    .setDescription('🎁 Start a giveaway.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('prize').setDescription('What can be won?').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('duration').setDescription('How long? e.g. 30m, 2h, 1d, 1d12h').setRequired(true).setMaxLength(20))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),

  async execute(interaction) {
    const prize = interaction.options.getString('prize', true).trim();
    const duration = parseDuration(interaction.options.getString('duration', true));
    const winners = interaction.options.getInteger('winners') ?? 1;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    if (!duration || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
      return interaction.reply(
        ephemeral(embeds.error(interaction, 'Invalid Duration', 'Use a number with **s**, **m**, **h**, **d** or **w**, for example `30m`, `2h`, `1d` or `1d12h`.\nMinimum 10 seconds, maximum 30 days.')),
      );
    }

    await interaction.reply(ephemeral(embeds.loading(interaction, 'Starting the giveaway...')));

    const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    const perms = channel?.permissionsFor?.(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel ?? 'that channel'}.`)],
      });
    }

    const giveaway = {
      guildId: interaction.guildId,
      channelId: channel.id,
      prize,
      winners,
      hostId: interaction.user.id,
      endsAt: Date.now() + duration,
      entrants: [],
      ended: false,
      winnerIds: [],
    };

    const message = await channel.send({ embeds: [giveawayEmbed(interaction, giveaway)], components: [enterRow(giveaway)] });
    db.update('giveaways', (data) => {
      data[message.id] = giveaway;
    });

    await interaction.editReply({
      embeds: [
        embeds.success(interaction, 'Giveaway Started', `The giveaway for **${prize}** is live in ${channel}.`, {
          fields: [
            { name: '⏰ Ends', value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`, inline: true },
            { name: '🏆 Winners', value: `${winners}`, inline: true },
            { name: '🆔 Message ID', value: `\`${message.id}\``, inline: true },
            { name: '💡 Tip', value: 'End it early with `/gend`, pick new winners with `/greroll`.' },
          ],
        }),
      ],
    });
  },
};
