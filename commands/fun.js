/**
 * /fun 8ball <question> | coinflip | dice [sides] | choose <options>
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');

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

    if (sub === '8ball') return reply('🎱 Magic 8-Ball', `**Q:** ${interaction.options.getString('question', true)}\n**A:** ${pick(ANSWERS)}`);
    if (sub === 'coinflip') return reply('🪙 Coin Flip', `It landed on **${pick(['Heads', 'Tails'])}**!`, embeds.COLORS.gold);
    if (sub === 'dice') {
      const sides = interaction.options.getInteger('sides') ?? 6;
      return reply('🎲 Dice Roll', `You rolled **${1 + Math.floor(Math.random() * sides)}** (1-${sides}).`, embeds.COLORS.cyan);
    }
    const options = interaction.options.getString('options', true).split('|').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Need More Options', 'Give at least two options separated by `|`.')));
    return reply('🤔 I Choose...', `**${pick(options)}** ${embeds.e('bow')}`);
  },
};
