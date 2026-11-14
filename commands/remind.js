/**
 * /remind <in> <text>
 * Reminds you after the given time (e.g. 10m, 2h, 1d) in the same
 * channel, or by DM if the channel is gone. Survives restarts.
 *
 * `tick(client)` is called every few seconds from events/ready.js.
 * Storage: data/reminders.json { "<id>": { userId, channelId, text, at, createdAt } }
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const MAX_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_PER_USER = 10;

/** Deliver every reminder whose time has come. */
async function tick(client) {
  const due = Object.entries(db.get('reminders')).filter(([, r]) => r.at <= Date.now());
  if (!due.length) return;
  // Remove first, so a slow/failed delivery can never send a reminder twice.
  db.update('reminders', (data) => {
    for (const [id] of due) delete data[id];
  });

  for (const [, reminder] of due) {
    const payload = {
      content: `<@${reminder.userId}>`,
      embeds: [
        embeds.make(client, {
          color: embeds.COLORS.gold,
          title: '⏰ Reminder',
          description: reminder.text,
          fields: [{ name: '🕒 Set', value: `<t:${Math.floor(reminder.createdAt / 1000)}:R>`, inline: true }],
        }),
      ],
      allowedMentions: { users: [reminder.userId] },
    };
    try {
      const channel = await client.channels.fetch(reminder.channelId);
      await channel.send(payload);
    } catch {
      const user = await client.users.fetch(reminder.userId).catch(() => null);
      await user?.send(payload).catch(() => {});
    }
  }
}

module.exports = {
  tick,

  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('⏰ Set a reminder.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('in').setDescription('When? e.g. 10m, 2h, 1d, 1d12h').setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName('text').setDescription('What should I remind you about?').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    const duration = embeds.parseDuration(interaction.options.getString('in', true));
    if (!duration || duration < 10_000 || duration > MAX_MS) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Time', 'Use something like `10m`, `2h` or `1d12h` (10 seconds to 1 year).')));
    }
    const mine = Object.values(db.get('reminders')).filter((r) => r.userId === interaction.user.id).length;
    if (mine >= MAX_PER_USER) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Too Many Reminders', `You can have up to **${MAX_PER_USER}** active reminders.`)));
    }

    const at = Date.now() + duration;
    db.update('reminders', (data) => {
      data[`${interaction.id}`] = { userId: interaction.user.id, channelId: interaction.channelId, text: interaction.options.getString('text', true), at, createdAt: Date.now() };
    });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Reminder Set', `I will remind you <t:${Math.floor(at / 1000)}:R> in this channel.`)));
  },
};
