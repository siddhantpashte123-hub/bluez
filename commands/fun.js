/**
 * /fun 8ball <question> | coinflip | dice [sides] | choose <options>
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const crypto = require('node:crypto');
const embeds = require('../utils/embeds');
const cards = require('../utils/cards');
const branding = require('../utils/branding');
const { sendCard } = require('../utils/card-response');

const ANSWERS = ['Yes, definitely.', 'Without a doubt.', 'Most likely.', 'Signs point to yes.', 'Ask again later.', 'I am not sure.', 'Better not tell you now.', 'Do not count on it.', 'My sources say no.', 'Very doubtful.'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('🎲 Fun commands.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('8ball').setDescription('🎱 Ask the magic 8-ball.').addStringOption((o) => o.setName('question').setDescription('Your yes/no question').setRequired(true).setMaxLength(300)))
    .addSubcommand((s) => s.setName('coinflip').setDescription('🪙 Flip a coin.'))
    .addSubcommand((s) => s.setName('dice').setDescription('🎲 Roll a dice.').addIntegerOption((o) => o.setName('sides').setDescription('Number of sides (default 6)').setMinValue(2).setMaxValue(1000)))
    .addSubcommand((s) => s.setName('choose').setDescription('🤔 Let me choose for you.').addStringOption((o) => o.setName('options').setDescription('Options separated by |   e.g. Pizza | Burger').setRequired(true).setMaxLength(500))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const reply = (title, description, color = embeds.COLORS.purple) => interaction.reply({ embeds: [embeds.make(interaction, { color, title, description })] });

    if (sub === '8ball') {
      const question = interaction.options.getString('question', true), answer = pick(ANSWERS);
      const embed = embeds.make(interaction, { color: embeds.COLORS.purple, title: '🎱 Magic 8-Ball', description: `**Q:** ${question}\n**A:** ${answer}`, thumbnail: false });
      let png = null;
      if (cards.available()) {
        await interaction.deferReply();
        png = await cards.featureCard({ eyebrow: 'Magic 8-Ball', title: answer, detail: question, badge: '8', footer: `Asked by ${interaction.member?.displayName ?? interaction.user.username}`, accent: branding.accent(interaction.guildId ?? interaction.guild.id) }).catch(() => null);
      }
      return sendCard(interaction, embed, png, '8ball.png');
    }
    if (sub === 'coinflip') {
      // One unbiased, independent draw per command; repeats are possible.
      const result = crypto.randomInt(2) === 0 ? 'Heads' : 'Tails';
      const embed = embeds.make(interaction, { color: embeds.COLORS.gold, title: '🪙 Coin Flip', description: `It landed on **${result}**!`, thumbnail: false });
      let png = null;
      if (cards.available()) {
        await interaction.deferReply();
        png = await cards.coinFlipCard({ result, username: interaction.member?.displayName ?? interaction.user.username, accent: branding.accent(interaction.guildId ?? interaction.guild.id) })
          .catch((err) => (console.error('[/fun coinflip] card:', err.message), null));
      }
      return sendCard(interaction, embed, png, 'coinflip.png');
    }
    if (sub === 'dice') {
      const sides = interaction.options.getInteger('sides') ?? 6;
      const result = 1 + crypto.randomInt(sides);
      const embed = embeds.make(interaction, { color: embeds.COLORS.cyan, title: '🎲 Dice Roll', description: `You rolled **${result}** (1-${sides}).`, thumbnail: false });
      let png = null;
      if (cards.available()) {
        await interaction.deferReply();
        png = await cards.featureCard({ eyebrow: 'Dice roll', title: `You rolled ${result}`, detail: `${sides}-sided dice`, badge: String(result), footer: `Rolled by ${interaction.member?.displayName ?? interaction.user.username}`, accent: branding.accent(interaction.guildId ?? interaction.guild.id) }).catch(() => null);
      }
      return sendCard(interaction, embed, png, 'dice.png');
    }
    const options = interaction.options.getString('options', true).split('|').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Need More Options', 'Give at least two options separated by `|`.')));
    return reply('🤔 I Choose...', `**${pick(options)}** ${embeds.e('bow')}`);
  },
};
