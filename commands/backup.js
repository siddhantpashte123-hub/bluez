/** Export a non-destructive server configuration snapshot; never restores or deletes resources. */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('backup').setDescription('Export a server configuration snapshot (administrators).')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('export').setDescription('Download a private JSON snapshot of roles and channels.')),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use the Slash Command', 'For privacy, use `/backup export` instead of a prefix command.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Administrator Only', 'You need the Administrator permission.')));
    await interaction.deferReply({ flags: 64 });
    const { guild } = interaction;
    const [roles, channels] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    const snapshot = {
      version: 1, exportedAt: new Date().toISOString(),
      guild: { id: guild.id, name: guild.name, verificationLevel: guild.verificationLevel, defaultMessageNotifications: guild.defaultMessageNotifications, explicitContentFilter: guild.explicitContentFilter },
      roles: [...roles.values()].filter(Boolean).map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, position: r.position, managed: r.managed, permissions: r.permissions.bitfield.toString() })),
      channels: [...channels.values()].filter(Boolean).map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition, topic: c.topic ?? null, nsfw: c.nsfw ?? false, rateLimitPerUser: c.rateLimitPerUser ?? 0, permissionOverwrites: [...(c.permissionOverwrites?.cache?.values() ?? [])].map((p) => ({ id: p.id, type: p.type, allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString() })) })),
    };
    const buffer = Buffer.from(JSON.stringify(snapshot, null, 2));
    if (buffer.length > 7_000_000) return interaction.editReply({ embeds: [embeds.error(interaction, 'Snapshot Too Large', 'This server snapshot exceeds the attachment limit.')] });
    return interaction.editReply({ embeds: [embeds.info(interaction, 'Server Snapshot', 'Private JSON export of roles, channels and selected server settings. Store it securely. This is a reference snapshot, not an automatic restore; messages, members, bot data and secrets are not included.')], files: [new AttachmentBuilder(buffer, { name: `server-${guild.id}-snapshot.json` })] });
  },
};
