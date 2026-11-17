const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const db = require('../utils/db');
const embeds = require('../utils/embeds');
const audit = require('../utils/audit');
module.exports = {
  data: new SlashCommandBuilder().setName('branding').setDescription('Customize the server bot branding.').setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('set').setDescription('Set branding fields; omitted fields stay unchanged.')
      .addStringOption((o) => o.setName('color').setDescription('Hex accent color, e.g. #5865F2').setMaxLength(7))
      .addStringOption((o) => o.setName('name').setDescription('Display name in the help menu').setMaxLength(40))
      .addStringOption((o) => o.setName('footer').setDescription('Embed footer text').setMaxLength(80)))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset branding to defaults.')),
  async execute(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.reply(embeds.ephemeral(embeds.error(i, 'Missing Permission', 'Manage Server is required.')));
    if (i.options.getSubcommand() === 'reset') {
      db.updateGuild('settings', i.guildId, (s) => { delete s.branding; });
      audit.record(i.guildId, i.user.id, 'branding.reset');
      return i.reply(embeds.ephemeral(embeds.success(i, 'Branding Reset', 'Defaults restored.')));
    }
    const color = i.options.getString('color'), name = i.options.getString('name'), footer = i.options.getString('footer');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return i.reply(embeds.ephemeral(embeds.error(i, 'Invalid Color', 'Use a hex color like `#5865F2`.')));
    if (name === null && footer === null && color === null) return i.reply(embeds.ephemeral(embeds.warn(i, 'No Changes', 'Provide a color, name or footer.')));
    if ((name !== null && !name.trim()) || (footer !== null && !footer.trim())) return i.reply(embeds.ephemeral(embeds.error(i, 'Invalid Text', 'Name and footer cannot be blank.')));
    db.updateGuild('settings', i.guildId, (s) => { const b = (s.branding ??= {}); if (color) b.color = parseInt(color.slice(1), 16); if (name !== null) b.name = name.trim(); if (footer !== null) b.footer = footer.trim(); });
    audit.record(i.guildId, i.user.id, 'branding.set');
    return i.reply(embeds.ephemeral(embeds.success(i, 'Branding Saved', 'Help name, embed footer/accent and image-card accents updated.')));
  },
};
