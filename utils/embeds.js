/**
 * utils/embeds.js
 * ---------------------------------------------------------------
 * Shared embed factory so EVERY reply of the bot looks the same:
 * coloured sidebar, bot avatar thumbnail, "<bot name>" footer and
 * a timestamp.
 *
 * `ctx` can be an Interaction, a Message or the Client itself.
 * ---------------------------------------------------------------
 */
const { EmbedBuilder } = require('discord.js');

/** Brand colours used across the bot. */
const COLORS = {
  blurple: 0x5865f2, // primary / info
  cyan: 0x00e5ff, // loading / utility
  pink: 0xff4d6d, // errors / moderation
  green: 0x2ee59d, // success
  gold: 0xffc94d, // warnings / leaderboards
  purple: 0x9b5cff, // automation
};

/** Resolve the Client from whatever we were given. */
function clientOf(ctx) {
  return ctx?.client ?? ctx;
}

/**
 * Base embed. All other helpers go through here.
 * @param {object} ctx  Interaction | Message | Client
 * @param {object} opts { color, title, description, fields, image, thumbnail, footer }
 */
function make(ctx, opts = {}) {
  const client = clientOf(ctx);
  const botName = client?.user?.username ?? 'Discord Bot';
  const avatar = client?.user?.displayAvatarURL?.({ size: 256 }) ?? null;

  const embed = new EmbedBuilder()
    .setColor(opts.color ?? COLORS.blurple)
    .setFooter({
      text: opts.footer ? `${botName} • ${opts.footer}` : botName,
      iconURL: avatar ?? undefined,
    })
    .setTimestamp();

  if (opts.title) embed.setTitle(String(opts.title).slice(0, 256));
  if (opts.description) embed.setDescription(String(opts.description).slice(0, 4096));
  if (opts.fields?.length) embed.addFields(opts.fields.slice(0, 25));
  if (opts.image) embed.setImage(opts.image);

  // thumbnail: false -> none, string -> custom, otherwise the bot avatar
  const thumb = opts.thumbnail === false ? null : opts.thumbnail ?? avatar;
  if (thumb) embed.setThumbnail(thumb);

  return embed;
}

/** ✅ Green success embed. */
const success = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.green, title: `✅ ${title}`, description, ...extra });

/** ❌ Red/pink error embed. */
const error = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.pink, title: `❌ ${title}`, description, ...extra });

/** ⚠️ Gold warning embed. */
const warn = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.gold, title: `⚠️ ${title}`, description, ...extra });

/** ℹ️ Blurple info embed. */
const info = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.blurple, title, description, ...extra });

/** ⌛ Cyan "loading" embed – always edited into a final embed afterwards. */
const loading = (ctx, text = 'Working...') =>
  make(ctx, { color: COLORS.cyan, title: `⌛ ${text}`, description: '`▰▰▰▱▱▱▱▱▱▱` Please wait a moment.' });

/** Text progress bar, e.g. bar(45, 120) -> ▰▰▰▰▰▱▱▱▱▱▱▱▱▱ */
function bar(done, total, size = 14) {
  const filled = total > 0 ? Math.min(size, Math.round((done / total) * size)) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

/** Small helper used for delays and the "loading -> final" animation feel. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { COLORS, make, success, error, warn, info, loading, bar, sleep };
