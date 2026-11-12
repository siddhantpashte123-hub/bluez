/**
 * /poll <question> <options>
 * Button poll. Options are separated by "|" (2 to 5), e.g.
 *   /poll question:Best game? options:Minecraft | GTA | Valorant
 * Members vote with the buttons (one vote each, can be changed).
 * The poll author or a moderator can end it with the "End" button.
 *
 * Also used by /suggest (a suggestion is a poll with 👍 / 👎).
 *
 * Button IDs: "poll_v_<index>" and "poll_end".
 * Storage: data/polls.json
 *   { "<messageId>": { guildId, question, options: [], votes: { userId: index }, authorId, ended, kind } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

function pollEmbed(ctx, poll) {
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const suggestion = poll.kind === 'suggestion';
  const lines = poll.options.map((option, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `${suggestion ? '' : `${NUMBERS[i]} `}**${option}**\n\`${embeds.bar(counts[i], total || 1, 16)}\` ${counts[i]} vote${counts[i] === 1 ? '' : 's'} (${pct}%)`;
  });
  return embeds.make(ctx, {
    color: poll.ended ? embeds.COLORS.pink : suggestion ? embeds.COLORS.gold : embeds.COLORS.blurple,
    title: suggestion ? '💡 Suggestion' : poll.ended ? '📊 Poll (ended)' : '📊 Poll',
    description: `### ${poll.question}\n\n${lines.join('\n\n')}`,
    fields: [
      { name: suggestion ? '🙋 Suggested by' : '🙋 Asked by', value: `<@${poll.authorId}>`, inline: true },
      { name: '🗳️ Total votes', value: `${total}`, inline: true },
    ],
  });
}

function pollRow(poll) {
  const suggestion = poll.kind === 'suggestion';
  const row = new ActionRowBuilder().addComponents(
    poll.options.map((option, i) =>
      new ButtonBuilder()
        .setCustomId(`poll_v_${i}`)
        .setLabel(suggestion ? option.replace(/^\S+\s/, '') : option.slice(0, 40))
        .setEmoji(suggestion ? ['👍', '👎'][i] : NUMBERS[i])
        .setStyle(suggestion ? (i === 0 ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Primary)
        .setDisabled(poll.ended),
    ),
  );
  // Polls with 5 options already fill the row (max 5 buttons), so "End" gets its own row.
  const end = new ButtonBuilder().setCustomId('poll_end').setLabel('End').setEmoji('🏁').setStyle(ButtonStyle.Secondary).setDisabled(poll.ended);
  if (suggestion) return [row];
  if (poll.options.length < 5) return [row.addComponents(end)];
  return [row, new ActionRowBuilder().addComponents(end)];
}

/** Post a poll (or suggestion) in a channel and store it. */
async function createPoll(ctx, channel, { question, options, authorId, kind = 'poll' }) {
  const poll = { guildId: channel.guildId, question, options, votes: {}, authorId, ended: false, kind };
  const message = await channel.send({ embeds: [pollEmbed(ctx, poll)], components: pollRow(poll) });
  db.update('polls', (data) => {
    data[message.id] = poll;
  });
  return message;
}

async function handleButton(interaction) {
  const poll = db.get('polls')[interaction.message.id];
  if (!poll) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Poll Not Found', 'This poll is too old.')));
  if (poll.ended) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Poll Ended', 'Voting is closed.')));

  if (interaction.customId === 'poll_end') {
    const allowed = interaction.user.id === poll.authorId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
    if (!allowed) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Not Allowed', 'Only the poll author or a moderator can end this poll.')));
    db.update('polls', (data) => {
      data[interaction.message.id].ended = true;
    });
  } else {
    const index = Number(interaction.customId.split('_')[2]);
    if (!(index >= 0 && index < poll.options.length)) return undefined;
    db.update('polls', (data) => {
      const votes = data[interaction.message.id].votes;
      if (votes[interaction.user.id] === index) delete votes[interaction.user.id]; // same button again = remove vote
      else votes[interaction.user.id] = index;
    });
  }
  const updated = db.get('polls')[interaction.message.id];
  return interaction.update({ embeds: [pollEmbed(interaction, updated)], components: pollRow(updated) });
}

module.exports = {
  handleButton,
  createPoll,

  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('📊 Create a button poll.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('question').setDescription('What do you want to ask?').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('options').setDescription('2-5 options separated by |   e.g. Yes | No | Maybe').setRequired(true).setMaxLength(400)),

  async execute(interaction) {
    const question = interaction.options.getString('question', true).trim();
    const options = [...new Set(interaction.options.getString('options', true).split('|').map((o) => o.trim()).filter(Boolean))];
    if (options.length < 2 || options.length > 5) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Options', 'Give **2 to 5** different options separated by `|`, for example `Yes | No | Maybe`.')));
    }
    if (options.some((o) => o.length > 80)) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Option Too Long', 'Each option can have up to 80 characters.')));
    }
    if (!interaction.channel?.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Post Here', 'I need **View Channel**, **Send Messages** and **Embed Links** in this channel.')));
    }
    await createPoll(interaction, interaction.channel, { question, options, authorId: interaction.user.id });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Poll Created', 'Your poll is live. Press **End** to close it.')));
  },
};
