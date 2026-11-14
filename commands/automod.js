/**
 * Auto-moderation
 * ---------------------------------------------------------------
 * /automod set <rule> <enabled>      turn a rule on or off
 * /automod word <add|remove> <word>  manage the blocked-word list
 * /automod status                    show the current setup
 *
 * Rules:
 *   invites   delete Discord invite links
 *   mentions  delete messages that ping more than 5 people
 *   spam      delete floods (6+ messages in 5 seconds) + 60s timeout
 *   words     delete messages containing a blocked word
 *
 * Members with "Manage Messages" are never touched.
 * The check itself is `check(message)`, called from events/messageCreate.js.
 *
 * Storage (data/settings.json):
 *   { "<guildId>": { "automod": { invites, mentions, spam, words: bool, wordList: [] } } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const logs = require('./logs');

const RULES = {
  invites: 'Discord invite links',
  mentions: 'Mass mentions (more than 5)',
  spam: 'Message spam / flooding',
  words: 'Blocked words',
};
const INVITE_REGEX = /(discord\.gg|discord(app)?\.com\/invite)\/[a-z0-9-]+/i;
const MAX_MENTIONS = 5;
const SPAM_COUNT = 6;
const SPAM_WINDOW_MS = 5000;
const SPAM_TIMEOUT_MS = 60_000;
const MAX_WORDS = 100;
const NOTICE_TTL_MS = 7000;

/** "guildId:userId" -> timestamps of recent messages */
const recent = new Map();

const configOf = (guildId) => db.guild('settings', guildId).automod ?? {};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which rule does this message break? Returns a short description or null. */
function violation(message, config) {
  const content = message.content ?? '';
  if (config.invites && INVITE_REGEX.test(content)) return 'Posting invite links is not allowed here.';
  if (config.mentions && message.mentions.users.size > MAX_MENTIONS) return 'Mass mentions are not allowed here.';
  if (config.words && config.wordList?.length) {
    const hit = config.wordList.find((word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(content));
    if (hit) return 'Your message contained a blocked word.';
  }
  if (config.spam) {
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const times = (recent.get(key) ?? []).filter((t) => now - t < SPAM_WINDOW_MS);
    times.push(now);
    recent.set(key, times);
    if (times.length >= SPAM_COUNT) {
      recent.delete(key);
      return 'SPAM';
    }
  }
  return null;
}

/**
 * Run automod on a message. Returns true when the message was removed
 * (the caller then skips autoresponder, XP, ...).
 */
async function check(message) {
  const config = configOf(message.guildId);
  if (!config.invites && !config.mentions && !config.spam && !config.words) return false;
  if (message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false; // staff are exempt

  const problem = violation(message, config);
  if (!problem) return false;

  const isSpam = problem === 'SPAM';
  await message.delete().catch(() => {});
  if (isSpam && message.member?.moderatable) await message.member.timeout(SPAM_TIMEOUT_MS, 'Automod: spam').catch(() => {});

  const text = isSpam ? 'Please slow down. You were muted for 60 seconds for spamming.' : problem;
  const notice = await message.channel
    .send({ content: `${message.author}`, embeds: [embeds.warn(message, 'Message Removed', text)], allowedMentions: { users: [message.author.id] } })
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_TTL_MS);

  logs.sendLog(message.guild, {
    embeds: [
      embeds.make(message, {
        color: embeds.COLORS.gold,
        title: '🤖 Automod',
        fields: [
          { name: '👤 Member', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
          { name: '📁 Channel', value: `${message.channel}`, inline: true },
          { name: '🚫 Rule', value: isSpam ? 'Spam' : problem },
          { name: '💬 Message', value: (message.content || '*no text*').slice(0, 1000) },
        ],
      }),
    ],
  });
  return true;
}

module.exports = {
  check,

  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('🤖 Automatic moderation.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('⚙️ Turn an automod rule on or off.')
        .addStringOption((o) => o.setName('rule').setDescription('Which rule').setRequired(true).addChoices(...Object.entries(RULES).map(([value, name]) => ({ name, value }))))
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('word').setDescription('🚫 Add or remove a blocked word.')
        .addStringOption((o) => o.setName('action').setDescription('Add or remove').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
        .addStringOption((o) => o.setName('word').setDescription('The word or phrase').setRequired(true).setMinLength(2).setMaxLength(50)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('📊 Show the automod settings.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'set') {
      const rule = interaction.options.getString('rule', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      db.updateGuild('settings', guildId, (s) => {
        (s.automod ??= {})[rule] = enabled;
      });
      const needsWords = rule === 'words' && enabled && !configOf(guildId).wordList?.length;
      return interaction.reply({
        embeds: [
          embeds.success(interaction, 'Automod Updated', `**${RULES[rule]}** is now **${enabled ? 'ON' : 'OFF'}**.${needsWords ? '\nAdd words with `/automod word`.' : ''}`, {
            footer: 'I need Manage Messages (and Timeout Members for spam)',
          }),
        ],
      });
    }

    if (sub === 'word') {
      const action = interaction.options.getString('action', true);
      const word = interaction.options.getString('word', true).trim().toLowerCase();
      const list = configOf(guildId).wordList ?? [];
      if (action === 'add') {
        if (list.includes(word)) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Already Blocked', 'That word is already on the list.')));
        if (list.length >= MAX_WORDS) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'List Is Full', `You can block up to **${MAX_WORDS}** words.`)));
      } else if (!list.includes(word)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Word Not Found', 'That word is not on the list.')));
      }
      db.updateGuild('settings', guildId, (s) => {
        const am = (s.automod ??= {});
        am.wordList = action === 'add' ? [...list, word] : list.filter((w) => w !== word);
        if (action === 'add') am.words = true; // adding a word switches the rule on
      });
      // Ephemeral, so the word itself is not shown to the whole channel.
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, action === 'add' ? 'Word Blocked' : 'Word Unblocked', `||${word}|| was ${action === 'add' ? 'added to' : 'removed from'} the list.`)));
    }

    const config = configOf(guildId);
    return interaction.reply(
      embeds.ephemeral(
        embeds.make(interaction, {
          color: embeds.COLORS.blurple,
          title: '🤖 Automod Settings',
          description: Object.entries(RULES).map(([key, name]) => `${config[key] ? '🟢' : '🔴'} **${name}**`).join('\n'),
          fields: [
            { name: `🚫 Blocked words (${config.wordList?.length ?? 0})`, value: config.wordList?.length ? `||${config.wordList.join(', ').slice(0, 1000)}||` : '*None*' },
            { name: '🛡️ Exempt', value: 'Members with **Manage Messages**' },
          ],
        }),
      ),
    );
  },
};
