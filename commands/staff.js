const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const db = require('../utils/db');
const embeds = require('../utils/embeds');
const tickets = require('./ticket');
module.exports = {
  data: new SlashCommandBuilder().setName('staff').setDescription('Support staff availability.').setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Set your availability.').addStringOption((o) => o.setName('state').setDescription('Availability').setRequired(true).addChoices({name:'Available',value:'available'}, {name:'Busy',value:'busy'}, {name:'Off duty',value:'off'})))
    .addSubcommand((s) => s.setName('list').setDescription('View staff availability privately.')),
  async execute(i) {
    if (i.isPrefix) return i.reply({ embeds: [embeds.warn(i, 'Use Slash Command', 'For privacy use `/staff`.')] });
    if (!tickets.isStaff(i.member, tickets.configOf(i.guildId))) return i.reply(embeds.ephemeral(embeds.error(i, 'Staff Only', 'Only support staff may use this.')));
    if (i.options.getSubcommand() === 'status') {
      const state = i.options.getString('state', true);
      if (!['available', 'busy', 'off'].includes(state)) return i.reply(embeds.ephemeral(embeds.error(i, 'Invalid Status', 'Choose an available status.')));
      db.updateGuild('staffstatus', i.guildId, (store) => { (store.users ??= {})[i.user.id] = { state, at: Date.now() }; });
      return i.reply(embeds.ephemeral(embeds.success(i, 'Status Saved', `Your status is **${state}**.`)));
    }
    const rows = Object.entries(db.guild('staffstatus', i.guildId).users ?? {}).sort((a,b) => b[1].at - a[1].at).slice(0, 25).map(([id, s]) => `<@${id}> — **${s.state}** • <t:${Math.floor(s.at / 1000)}:R>`);
    return i.reply({ ...embeds.ephemeral(embeds.make(i, { title: '🛟 Staff Availability', description: rows.join('\n') || 'No status set yet.' })), allowedMentions: { parse: [] } });
  },
};
