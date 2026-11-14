/**
 * /birthday set <day> <month> | remove | list | channel <channel>
 * Posts a birthday message once a day (checked by tick(), IST date).
 *
 * Storage (data/birthdays.json):
 *   { "<guildId>": { channelId, lastRun: "YYYY-MM-DD", users: { "<userId>": { day, month } } } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Today's date in India (the bot's audience), independent of the VPS time zone. */
function today() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, key: d.toISOString().slice(0, 10) };
}

/** Post today's birthdays (once per day and guild). */
async function tick(client) {
  const now = today();
  for (const [guildId, store] of Object.entries(db.get('birthdays'))) {
    if (!store.channelId || store.lastRun === now.key) continue;
    db.updateGuild('birthdays', guildId, (s) => {
      s.lastRun = now.key;
    });
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const ids = Object.entries(store.users ?? {}).filter(([, b]) => b.day === now.day && b.month === now.month).map(([id]) => id);
    if (!ids.length) continue;
    const present = [];
    for (const id of ids) if (await guild.members.fetch(id).catch(() => null)) present.push(id);
    if (!present.length) continue;
    const channel = await guild.channels.fetch(store.channelId).catch(() => null);
    await channel
      ?.send({
        content: present.map((id) => `<@${id}>`).join(' '),
        embeds: [embeds.make(client, { color: embeds.COLORS.gold, title: '🎂 Happy Birthday!', description: `Everyone wish ${present.map((id) => `<@${id}>`).join(', ')} a happy birthday! ${embeds.e('gift')}${embeds.e('bow')}` })],
        allowedMentions: { users: present },
      })
      .catch((err) => console.error('[Birthday]', err.message));
  }
}

module.exports = {
  tick,

  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('🎂 Birthdays.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('🎂 Save your birthday.')
        .addIntegerOption((o) => o.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('🗑️ Delete your birthday.'))
    .addSubcommand((s) => s.setName('list').setDescription('📜 Upcoming birthdays.'))
    .addSubcommand((s) =>
      s.setName('channel').setDescription('⚙️ Choose where birthdays are announced (admins).')
        .addChannelOption((o) => o.setName('channel').setDescription('Birthday channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;

    if (sub === 'channel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'You need the **Manage Server** permission for this.')));
      }
      const channel = interaction.options.getChannel('channel', true);
      if (!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`)));
      }
      db.updateGuild('birthdays', guild.id, (s) => {
        s.channelId = channel.id;
        s.users ??= {};
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Birthday Channel Set', `Birthdays will be announced in ${channel}.`)] });
    }

    if (sub === 'set') {
      const day = interaction.options.getInteger('day', true);
      const month = interaction.options.getInteger('month', true);
      if (day > DAYS_IN[month - 1]) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Date', `${MONTHS[month - 1]} does not have ${day} days.`)));
      db.updateGuild('birthdays', guild.id, (s) => {
        (s.users ??= {})[user.id] = { day, month };
      });
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Birthday Saved', `Your birthday is **${day} ${MONTHS[month - 1]}**. 🎂`)));
    }

    if (sub === 'remove') {
      db.updateGuild('birthdays', guild.id, (s) => {
        delete s.users?.[user.id];
      });
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Birthday Removed', 'Your birthday was deleted.')));
    }

    const now = today();
    const ordinal = (b) => ((b.month - now.month) * 31 + (b.day - now.day) + 372) % 372; // days-ish until the next one
    const upcoming = Object.entries(db.guild('birthdays', guild.id).users ?? {}).sort((a, b) => ordinal(a[1]) - ordinal(b[1])).slice(0, 10);
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.gold,
          title: '🎂 Upcoming Birthdays',
          description: upcoming.map(([id, b]) => `**${b.day} ${MONTHS[b.month - 1]}** — <@${id}>`).join('\n') || '*Nobody saved a birthday yet. Use `/birthday set`.*',
        }),
      ],
    });
  },
};
