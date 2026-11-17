const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const db = require('../utils/db');
const embeds = require('../utils/embeds');
module.exports = {
  data: new SlashCommandBuilder().setName('audit').setDescription('View recent supported bot configuration changes (admin).').setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(i) {
    if (i.isPrefix) return i.reply({ embeds: [embeds.warn(i, 'Use Slash Command', 'Use `/audit` for a private response.')] });
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.reply(embeds.ephemeral(embeds.error(i, 'Missing Permission', 'Manage Server is required.')));
    const entries = (db.guild('botaudit', i.guildId).entries ?? []).slice(-15).reverse();
    return i.reply({ ...embeds.ephemeral(embeds.make(i, { title: '📋 Bot Audit Log', description: entries.map((e) => `<t:${Math.floor(e.at / 1000)}:R> • <@${e.actorId}> • **${e.action}**${e.detail ? ` • ${e.detail}` : ''}`).join('\n') || 'No recorded actions yet.', footer: 'Selected bot actions only, not Discord audit logs' })), allowedMentions: { parse: [] } });
  },
};
