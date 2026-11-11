/**
 * events/messageCreate.js
 * Needs the MESSAGE CONTENT intent. Handles, in this order:
 *   1. AFK        – welcome back the author / notify about AFK mentions
 *   2. Auto reacter   – react to trigger words
 *   3. Autoresponder  – reply to trigger words
 */
const { Events, PermissionFlagsBits } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const { reactionOf } = require('../commands/autoreacter');

const RESPONDER_COOLDOWN_MS = 2500; // per channel, stops reply spam
const MAX_REACTIONS_PER_MESSAGE = 5;
const WELCOME_BACK_TTL_MS = 10_000;

/** channelId -> timestamp of the last auto-response */
const cooldowns = new Map();

/** "2h 5m" style duration. */
function duration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'a few seconds';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
}

/* ---------------- 1. AFK ---------------- */
async function handleAfk(message) {
  const afk = db.get('afk')[message.guildId];
  if (!afk) return;

  // The author is back -> remove the AFK status.
  const own = afk[message.author.id];
  if (own) {
    db.update('afk', (data) => {
      delete data[message.guildId][message.author.id];
    });
    const reply = await message
      .reply({
        embeds: [
          embeds.make(message, {
            color: embeds.COLORS.green,
            title: '👋 Welcome Back!',
            description: `${message.author}, your AFK status has been removed.\nYou were away for **${duration(Date.now() - own.since)}**.`,
            thumbnail: message.author.displayAvatarURL({ size: 256 }),
          }),
        ],
      })
      .catch(() => null);
    if (reply) setTimeout(() => reply.delete().catch(() => {}), WELCOME_BACK_TTL_MS);
  }

  // Someone pinged AFK users -> tell them.
  const lines = [];
  for (const user of message.mentions.users.values()) {
    if (user.id === message.author.id) continue;
    const entry = afk[user.id];
    if (entry) lines.push(`💤 ${user} is AFK: ${entry.reason}\n┗ *since <t:${Math.floor(entry.since / 1000)}:R>*`);
  }
  if (lines.length) {
    await message
      .reply({
        embeds: [embeds.make(message, { color: embeds.COLORS.purple, title: '💤 AFK Notice', description: lines.slice(0, 10).join('\n\n') })],
        allowedMentions: { parse: [], repliedUser: false }, // do not ping the AFK user again
      })
      .catch(() => {});
  }
}

/* ---------------- 2. Auto reacter ---------------- */
async function handleReacter(message, content) {
  const triggers = db.get('reacter')[message.guildId];
  if (!triggers) return;

  let count = 0;
  for (const [trigger, emoji] of Object.entries(triggers)) {
    if (!content.includes(trigger)) continue;
    // Deleted custom emoji / missing permission -> just skip it.
    await message.react(reactionOf(emoji)).catch(() => {});
    if (++count >= MAX_REACTIONS_PER_MESSAGE) break;
  }
}

/* ---------------- 3. Autoresponder ---------------- */
async function handleResponder(message, content) {
  const triggers = db.get('autoresponder')[message.guildId];
  if (!triggers) return;

  const hit = Object.entries(triggers).find(([trigger]) => content.includes(trigger));
  if (!hit) return;

  const last = cooldowns.get(message.channelId) ?? 0;
  if (Date.now() - last < RESPONDER_COOLDOWN_MS) return;
  cooldowns.set(message.channelId, Date.now());

  await message
    .reply({
      embeds: [embeds.make(message, { color: embeds.COLORS.blurple, description: hit[1], thumbnail: false })],
      allowedMentions: { parse: [], repliedUser: false }, // a response can never ping anyone
    })
    .catch(() => {});
}

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    // Ignore DMs, bots, webhooks and system messages.
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;

    // Can the bot even talk here?
    const me = message.guild.members.me;
    const perms = me ? message.channel.permissionsFor(me) : null;
    const canSend = perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) ?? false;
    const canReact = perms?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory]) ?? false;

    const content = (message.content ?? '').toLowerCase();

    // Each feature is isolated: one failing never blocks the others.
    if (canSend) await handleAfk(message).catch((err) => console.error('[AFK]', err.message));
    if (!content) return;
    if (canReact) await handleReacter(message, content).catch((err) => console.error('[Reacter]', err.message));
    if (canSend) await handleResponder(message, content).catch((err) => console.error('[Autoresponder]', err.message));
  },
};
