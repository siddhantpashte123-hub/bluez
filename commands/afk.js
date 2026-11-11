/**
 * /afk <reason>
 * Marks the user as AFK. The actual auto-reply / auto-remove logic
 * lives in events/messageCreate.js.
 *
 * Storage (data/afk.json):
 *   { "<guildId>": { "<userId>": { "reason": "...", "since": 1700000000000 } } }
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('💤 Set your AFK status. I will let people know when they ping you.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('reason').setDescription('Why are you away?').setRequired(true).setMaxLength(200)),

  async execute(interaction) {
    const reason = interaction.options.getString('reason', true).trim() || 'AFK';

    db.update('afk', (data) => {
      (data[interaction.guildId] ??= {})[interaction.user.id] = { reason, since: Date.now() };
    });

    await interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.purple,
          title: '💤 You Are Now AFK',
          description: `${interaction.user}, I will tell anyone who pings you that you are away.`,
          fields: [
            { name: '📝 Reason', value: reason },
            { name: '💡 Tip', value: 'Send any message to remove your AFK status.' },
          ],
          thumbnail: interaction.user.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
