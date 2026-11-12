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

/**
 * Custom emojis of this bot (uploaded in the Developer Portal → Emojis,
 * or in a server the bot is in). `fallback` is shown when the custom
 * emoji cannot be found, so the bot never prints broken ":name:" text.
 *
 * To add more: upload the emoji, copy its ID, add a line here, then use
 * it anywhere with  embeds.e('key').
 */
const EMOJIS = {
  tick: { id: '1570032627766001785', name: '381213tick', fallback: '✅' },
  caution: { id: '1570032630068412566', name: '315979dealwithcaution', fallback: '⚠️' },
  gift: { id: '1570032634736939129', name: '999108giftingluminary', fallback: '🎁' },
  giftLegend: { id: '1570032632316563558', name: '493187giftinglegend', fallback: '🎁' },
  bow: { id: '1570031909273346078', name: 'Screenshot20261109181001', fallback: '🎀' },
};

/** key -> ready-to-use emoji string. Filled by loadEmojis(); fallbacks until then. */
const resolved = Object.fromEntries(Object.entries(EMOJIS).map(([key, v]) => [key, v.fallback]));

/**
 * Get an emoji for use in embed text or on a button.
 * Returns "<:name:id>" (or "<a:name:id>") when available, else the unicode fallback.
 */
function e(key) {
  return resolved[key] ?? '';
}

/**
 * Look up every custom emoji once at startup (called from events/ready.js).
 * Checks the application's own emojis first, then the servers the bot is in.
 */
async function loadEmojis(client) {
  let appEmojis = null;
  try {
    appEmojis = await client.application.emojis.fetch();
  } catch (err) {
    console.warn('[Emojis] Could not fetch application emojis:', err.message);
  }

  const missing = [];
  for (const [key, def] of Object.entries(EMOJIS)) {
    const found = appEmojis?.get(def.id) ?? client.emojis.cache.get(def.id);
    if (found) {
      resolved[key] = `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
    } else {
      resolved[key] = def.fallback;
      missing.push(`${def.name} (${def.id})`);
    }
  }

  const total = Object.keys(EMOJIS).length;
  console.log(`✅ Custom emojis loaded: ${total - missing.length}/${total}.`);
  if (missing.length) {
    console.warn(`[Emojis] Not found, using normal emojis instead: ${missing.join(', ')}`);
    console.warn('[Emojis] Upload them under Developer Portal → your app → Emojis (of THIS bot), or check the IDs in utils/embeds.js.');
  }
}

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

/** Green success embed (custom tick emoji). */
const success = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.green, title: `${e('tick')} ${title}`, description, ...extra });

/** Red/pink error embed (custom caution emoji). */
const error = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.pink, title: `${e('caution')} ${title}`, description, ...extra });

/** Gold warning embed (custom caution emoji). */
const warn = (ctx, title, description, extra = {}) =>
  make(ctx, { color: COLORS.gold, title: `${e('caution')} ${title}`, description, ...extra });

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

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
/** "1d 12h", "30m", "45s" -> milliseconds (null when invalid). */
function parseDuration(input) {
  const text = String(input).toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(text)) return null;
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(amount) * UNIT_MS[unit];
  return total;
}

/** Wrap an embed as an "only you can see this" reply. */
const ephemeral = (embed) => ({ embeds: [embed], flags: 64 });

module.exports = { COLORS, EMOJIS, e, loadEmojis, parseDuration, ephemeral, make, success, error, warn, info, loading, bar, sleep };
