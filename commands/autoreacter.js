/**
 * /auto reacter set <trigger> <emoji>
 * /auto reacter remove <trigger>
 * /auto reacter list
 *
 * Storage (data/reacter.json):
 *   { "<guildId>": { "<trigger (lowercase)>": "<emoji>" } }
 *   emoji = unicode emoji ("🔥") or custom emoji ("<:name:id>" / "<a:name:id>")
 * The reacting itself happens in events/messageCreate.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const MAX_PER_GUILD = 50;
const CUSTOM_EMOJI = /^<a?:\w{2,32}:(\d{17,20})>$/;
// One emoji, including flags, skin tones, ZWJ sequences (👨‍👩‍👧) and keycaps (1️⃣).
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|[0-9#*]\uFE0F?\u20E3)+$/u;

/**
 * Validate the emoji option.
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
function parseEmoji(input, client) {
  const value = input.trim();
  const custom = value.match(CUSTOM_EMOJI);
  if (custom) {
    // The bot can only react with custom emojis from servers it is in.
    if (!client.emojis.cache.has(custom[1])) {
      return { ok: false, reason: 'I cannot use that custom emoji. It must belong to a server I am in.' };
    }
    return { ok: true, value };
  }
  if (value.length <= 32 && !/\s/.test(value) && UNICODE_EMOJI.test(value)) return { ok: true, value };
  return { ok: false, reason: 'Please provide **one** valid emoji, e.g. `🔥` or a custom server emoji.' };
}

/** What message.react() needs: the ID for custom emojis, the character otherwise. */
function reactionOf(stored) {
  const custom = stored.match(CUSTOM_EMOJI);
  return custom ? custom[1] : stored;
}

module.exports = {
  reactionOf,

  data: new SlashCommandBuilder()
    .setName('auto')
    .setDescription('🤖 Automation tools.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((group) =>
      group
        .setName('reacter')
        .setDescription('Automatic reactions to keywords.')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('➕ Add or update an auto-reaction.')
            .addStringOption((o) => o.setName('trigger').setDescription('Keyword to listen for').setRequired(true).setMinLength(1).setMaxLength(100))
            .addStringOption((o) => o.setName('emoji').setDescription('Emoji to react with (custom emojis work too)').setRequired(true).setMaxLength(80)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('➖ Remove an auto-reaction.')
            .addStringOption((o) => o.setName('trigger').setDescription('Keyword to remove').setRequired(true).setMaxLength(100)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('📜 List all auto-reactions of this server.')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const store = db.get('reacter')[guildId] ?? {};

    if (sub === 'set') {
      const trigger = interaction.options.getString('trigger', true).trim().toLowerCase();
      const emoji = parseEmoji(interaction.options.getString('emoji', true), interaction.client);

      if (!trigger) {
        return interaction.reply({ embeds: [embeds.error(interaction, 'Invalid Trigger', 'The trigger cannot be empty.')] });
      }
      if (!emoji.ok) {
        return interaction.reply({ embeds: [embeds.error(interaction, 'Invalid Emoji', emoji.reason)] });
      }
      if (!(trigger in store) && Object.keys(store).length >= MAX_PER_GUILD) {
        return interaction.reply({
          embeds: [embeds.error(interaction, 'Limit Reached', `A server can have up to **${MAX_PER_GUILD}** auto-reactions. Remove one first.`)],
        });
      }

      const updated = trigger in store;
      db.update('reacter', (data) => {
        (data[guildId] ??= {})[trigger] = emoji.value;
      });

      return interaction.reply({
        embeds: [
          embeds.success(interaction, updated ? 'Auto-Reaction Updated' : 'Auto-Reaction Added', 'I will react whenever a message contains the trigger.', {
            fields: [
              { name: '🎯 Trigger', value: `\`${trigger}\``, inline: true },
              { name: '😀 Emoji', value: emoji.value, inline: true },
            ],
          }),
        ],
      });
    }

    if (sub === 'remove') {
      const trigger = interaction.options.getString('trigger', true).trim().toLowerCase();
      if (!(trigger in store)) {
        return interaction.reply({
          embeds: [embeds.error(interaction, 'Trigger Not Found', `There is no auto-reaction for \`${trigger}\`. Use \`/auto reacter list\` to see all of them.`)],
        });
      }
      db.update('reacter', (data) => {
        delete data[guildId][trigger];
      });
      return interaction.reply({
        embeds: [embeds.success(interaction, 'Auto-Reaction Removed', `I will no longer react to \`${trigger}\`.`)],
      });
    }

    // ---- list ----
    const entries = Object.entries(store);
    if (!entries.length) {
      return interaction.reply({
        embeds: [embeds.warn(interaction, 'No Auto-Reactions', 'Nothing here yet. Add one with `/auto reacter set`.')],
      });
    }
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.purple,
          title: `😀 Auto-Reactions (${entries.length}/${MAX_PER_GUILD})`,
          description: entries.map(([trigger, emoji], i) => `**${i + 1}.** \`${trigger}\` ➜ ${emoji}`).join('\n'),
        }),
      ],
    });
  },
};
