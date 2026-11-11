/**
 * /autoresponder set <trigger> <response>
 * /autoresponder remove <trigger>
 * /autoresponder list
 *
 * Storage (data/autoresponder.json):
 *   { "<guildId>": { "<trigger (lowercase)>": "<response>" } }
 * The replying itself happens in events/messageCreate.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const MAX_PER_GUILD = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('💬 Automatic replies to keywords.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('➕ Add or update an auto-response.')
        .addStringOption((o) => o.setName('trigger').setDescription('Keyword to listen for').setRequired(true).setMinLength(1).setMaxLength(100))
        .addStringOption((o) => o.setName('response').setDescription('What the bot should reply').setRequired(true).setMaxLength(1500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('➖ Remove an auto-response.')
        .addStringOption((o) => o.setName('trigger').setDescription('Keyword to remove').setRequired(true).setMaxLength(100)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('📜 List all auto-responses of this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const store = db.get('autoresponder')[guildId] ?? {};

    if (sub === 'set') {
      const trigger = interaction.options.getString('trigger', true).trim().toLowerCase();
      const response = interaction.options.getString('response', true).trim();

      if (!trigger || !response) {
        return interaction.reply({ embeds: [embeds.error(interaction, 'Invalid Input', 'The trigger and the response cannot be empty.')] });
      }
      if (!(trigger in store) && Object.keys(store).length >= MAX_PER_GUILD) {
        return interaction.reply({
          embeds: [embeds.error(interaction, 'Limit Reached', `A server can have up to **${MAX_PER_GUILD}** auto-responses. Remove one first.`)],
        });
      }

      const updated = trigger in store;
      db.update('autoresponder', (data) => {
        (data[guildId] ??= {})[trigger] = response;
      });

      return interaction.reply({
        embeds: [
          embeds.success(interaction, updated ? 'Auto-Response Updated' : 'Auto-Response Added', 'I will reply whenever a message contains the trigger.', {
            fields: [
              { name: '🎯 Trigger', value: `\`${trigger}\``, inline: true },
              { name: '💬 Response', value: response.slice(0, 1024) },
            ],
          }),
        ],
      });
    }

    if (sub === 'remove') {
      const trigger = interaction.options.getString('trigger', true).trim().toLowerCase();
      if (!(trigger in store)) {
        return interaction.reply({
          embeds: [embeds.error(interaction, 'Trigger Not Found', `There is no auto-response for \`${trigger}\`. Use \`/autoresponder list\` to see all of them.`)],
        });
      }
      db.update('autoresponder', (data) => {
        delete data[guildId][trigger];
      });
      return interaction.reply({
        embeds: [embeds.success(interaction, 'Auto-Response Removed', `I will no longer reply to \`${trigger}\`.`)],
      });
    }

    // ---- list ----
    const entries = Object.entries(store);
    if (!entries.length) {
      return interaction.reply({
        embeds: [embeds.warn(interaction, 'No Auto-Responses', 'Nothing here yet. Add one with `/autoresponder set`.')],
      });
    }
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.purple,
          title: `💬 Auto-Responses (${entries.length}/${MAX_PER_GUILD})`,
          description: entries
            .map(([trigger, response], i) => `**${i + 1}.** \`${trigger}\` ➜ ${response.length > 60 ? `${response.slice(0, 60)}…` : response}`)
            .join('\n'),
        }),
      ],
    });
  },
};
