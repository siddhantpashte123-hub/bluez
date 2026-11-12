/**
 * Economy (server coins)
 * ---------------------------------------------------------------
 * /eco balance [user]     show coins
 * /eco daily              500 coins every 24 hours
 * /eco work               50-200 coins every hour
 * /eco pay <user> <amount>
 * /eco leaderboard        richest members
 *
 * Coins are a game currency inside the server only (no real money).
 * Storage: data/economy.json { "<guildId>": { "<userId>": { coins, lastDaily, lastWork } } }
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const DAILY_AMOUNT = 500;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;
const JOBS = ['delivered pizzas', 'fixed a bug', 'streamed for an hour', 'sold lemonade', 'drove a taxi', 'designed a logo', 'mined some ore'];
const MEDALS = ['🥇', '🥈', '🥉'];
const coins = (n) => `🪙 **${n.toLocaleString('en-IN')}**`;

const wallet = (guildId, userId) => db.guild('economy', guildId)[userId] ?? { coins: 0, lastDaily: 0, lastWork: 0 };
/** Change a wallet and return the new state. */
function change(guildId, userId, mutator) {
  return db.updateGuild('economy', guildId, (data) => {
    mutator((data[userId] ??= { coins: 0, lastDaily: 0, lastWork: 0 }));
  })[userId];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('🪙 Server economy.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('balance').setDescription('🪙 Show your coins.').addUserOption((o) => o.setName('user').setDescription('Another member')))
    .addSubcommand((s) => s.setName('daily').setDescription('🎁 Collect your daily coins.'))
    .addSubcommand((s) => s.setName('work').setDescription('💼 Work for coins (once per hour).'))
    .addSubcommand((s) =>
      s.setName('pay').setDescription('💸 Give coins to another member.')
        .addUserOption((o) => o.setName('user').setDescription('Who gets the coins').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('How many coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    )
    .addSubcommand((s) => s.setName('leaderboard').setDescription('🏆 Richest members.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guildId, user } = interaction;
    const now = Date.now();
    const wait = (title, readyAt) => interaction.reply(embeds.ephemeral(embeds.warn(interaction, title, `Come back <t:${Math.floor(readyAt / 1000)}:R>.`)));

    if (sub === 'balance') {
      const target = interaction.options.getUser('user') ?? user;
      return interaction.reply({
        embeds: [embeds.make(interaction, { color: embeds.COLORS.gold, title: `🪙 Balance of ${target.username}`, description: `${target} has ${coins(wallet(guildId, target.id).coins)} coins.`, thumbnail: target.displayAvatarURL({ size: 256 }) })],
      });
    }

    if (sub === 'daily') {
      const current = wallet(guildId, user.id);
      if (now - current.lastDaily < DAILY_COOLDOWN_MS) return wait('Already Collected', current.lastDaily + DAILY_COOLDOWN_MS);
      const updated = change(guildId, user.id, (w) => {
        w.coins += DAILY_AMOUNT;
        w.lastDaily = now;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Daily Reward', `${embeds.e('gift')} You collected ${coins(DAILY_AMOUNT)} coins.\nBalance: ${coins(updated.coins)}`)] });
    }

    if (sub === 'work') {
      const current = wallet(guildId, user.id);
      if (now - current.lastWork < WORK_COOLDOWN_MS) return wait('You Are Tired', current.lastWork + WORK_COOLDOWN_MS);
      const earned = 50 + Math.floor(Math.random() * 151);
      const updated = change(guildId, user.id, (w) => {
        w.coins += earned;
        w.lastWork = now;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Work Done', `You ${JOBS[Math.floor(Math.random() * JOBS.length)]} and earned ${coins(earned)} coins.\nBalance: ${coins(updated.coins)}`)] });
    }

    if (sub === 'pay') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (target.bot || target.id === user.id) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Member', 'You cannot pay yourself or a bot.')));
      if (wallet(guildId, user.id).coins < amount) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Not Enough Coins', `You only have ${coins(wallet(guildId, user.id).coins)} coins.`)));
      }
      change(guildId, user.id, (w) => {
        w.coins -= amount;
      });
      change(guildId, target.id, (w) => {
        w.coins += amount;
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Payment Sent', `${user} paid ${coins(amount)} coins to ${target}.`)] });
    }

    const board = Object.entries(db.guild('economy', guildId)).filter(([, w]) => w.coins > 0).sort((a, b) => b[1].coins - a[1].coins);
    if (!board.length) return interaction.reply({ embeds: [embeds.warn(interaction, 'Nobody Has Coins Yet', 'Start with `/eco daily`.')] });
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.gold,
          title: `${embeds.e('giftLegend')} Richest Members`,
          description: board.slice(0, 10).map(([id, w], i) => `${MEDALS[i] ?? `\`#${i + 1}\``} <@${id}> — ${coins(w.coins)}`).join('\n'),
        }),
      ],
    });
  },
};
