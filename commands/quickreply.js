const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const snippets = require('../utils/snippets');
const embeds = require('../utils/embeds');
const tickets = require('./ticket');
const key = o => o.setName('key').setDescription('Reply key (letters, numbers, - or _)').setRequired(true).setMaxLength(32);
module.exports = {
  data: new SlashCommandBuilder().setName('quickreply').setDescription('Reusable ticket replies.').setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('set').setDescription('Save a ticket reply (Manage Server).').addStringOption(key).addStringOption(o => o.setName('text').setDescription('Text sent publicly in the ticket').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a reply (Manage Server).').addStringOption(key))
    .addSubcommand(s => s.setName('list').setDescription('List reply keys (ticket staff).'))
    .addSubcommand(s => s.setName('send').setDescription('Send a saved reply in this ticket (ticket staff).').addStringOption(key)),
  async execute(i) {
    const sub = i.options.getSubcommand(), gid = i.guildId ?? i.guild.id;
    if (['set', 'remove'].includes(sub) && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.reply(embeds.ephemeral(embeds.error(i, 'Missing Permission', 'Manage Server is required.')));
    if (['send', 'list'].includes(sub)) {
      if (sub === 'list' && i.isPrefix) return i.reply({ embeds: [embeds.warn(i, 'Use Slash Command', 'For privacy, use `/quickreply list`.')] });
      const config = tickets.configOf(gid), ticket = config?.tickets?.[i.channelId];
      if (!ticket) return i.reply(embeds.ephemeral(embeds.error(i, 'Not a Ticket', 'Use this inside an open tracked ticket.')));
      if (ticket.userId === i.user.id || !tickets.isStaff(i.member, config, ticket)) return i.reply(embeds.ephemeral(embeds.error(i, 'Staff Only', 'Only the ticket support team can use quick replies.')));
    }
    try {
      if (sub === 'set') {
        snippets.set('quickreplies', gid, i.options.getString('key', true), i.options.getString('text', true));
        return i.reply(embeds.ephemeral(embeds.success(i, 'Quick Reply Saved', 'Staff can send this publicly in a ticket with `/quickreply send`.')));
      }
      if (sub === 'remove') {
        const removed = snippets.remove('quickreplies', gid, i.options.getString('key', true));
        return i.reply(embeds.ephemeral(removed ? embeds.success(i, 'Quick Reply Removed', 'The reply was removed.') : embeds.warn(i, 'Not Found', 'No quick reply has that key.')));
      }
      if (sub === 'list') {
        const keys = Object.keys(snippets.list('quickreplies', gid)).sort();
        return i.reply(embeds.ephemeral(embeds.info(i, '💬 Quick Replies', keys.length ? keys.map(k => `\`${k}\``).join(' • ') : 'No quick replies yet.')));
      }
      const text = snippets.get('quickreplies', gid, i.options.getString('key', true));
      if (!text) return i.reply(embeds.ephemeral(embeds.warn(i, 'Not Found', 'Use `/quickreply list` inside a ticket.')));
      return i.reply({ content: text, allowedMentions: { parse: [] } });
    } catch (err) { return i.reply(embeds.ephemeral(embeds.error(i, 'Quick Reply Error', err.message.slice(0, 250)))); }
  },
};
