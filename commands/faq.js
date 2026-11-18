const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const snippets = require('../utils/snippets');
const embeds = require('../utils/embeds');
const key = o => o.setName('key').setDescription('Short FAQ key (letters, numbers, - or _)').setRequired(true).setMaxLength(32);
module.exports = {
  data: new SlashCommandBuilder().setName('faq').setDescription('Public server FAQs.').setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('set').setDescription('Create or update a public answer (Manage Server).').addStringOption(key).addStringOption(o => o.setName('answer').setDescription('Public answer').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove an FAQ (Manage Server).').addStringOption(key))
    .addSubcommand(s => s.setName('list').setDescription('List FAQ keys.'))
    .addSubcommand(s => s.setName('view').setDescription('Show a public FAQ answer.').addStringOption(key)),
  async execute(i) {
    const sub = i.options.getSubcommand(), guildId = i.guildId ?? i.guild.id;
    if (['set', 'remove'].includes(sub) && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.reply(embeds.ephemeral(embeds.error(i, 'Missing Permission', 'Manage Server is required.')));
    try {
      if (sub === 'set') {
        snippets.set('faq', guildId, i.options.getString('key', true), i.options.getString('answer', true));
        return i.reply(embeds.ephemeral(embeds.success(i, 'FAQ Saved', 'The public answer is available with `/faq view`.')));
      }
      if (sub === 'remove') {
        const removed = snippets.remove('faq', guildId, i.options.getString('key', true));
        return i.reply(embeds.ephemeral(removed ? embeds.success(i, 'FAQ Removed', 'The answer was removed.') : embeds.warn(i, 'Not Found', 'No FAQ has that key.')));
      }
      if (sub === 'list') {
        const keys = Object.keys(snippets.list('faq', guildId)).sort();
        return i.reply({ embeds: [embeds.info(i, '📚 Server FAQs', keys.length ? keys.map(k => `\`${k}\``).join(' • ') : 'No FAQs yet.')], allowedMentions: { parse: [] } });
      }
      const id = snippets.keyOf(i.options.getString('key', true)), answer = snippets.get('faq', guildId, id);
      if (!answer) return i.reply(embeds.ephemeral(embeds.warn(i, 'FAQ Not Found', 'Use `/faq list` to see available keys.')));
      return i.reply({ embeds: [embeds.make(i, { title: `📚 FAQ: ${id}`, description: answer })], allowedMentions: { parse: [] } });
    } catch (err) { return i.reply(embeds.ephemeral(embeds.error(i, 'FAQ Error', err.message.slice(0, 250)))); }
  },
};
