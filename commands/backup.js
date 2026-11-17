/** Private snapshots and explicit, additive safe skeleton restore. */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { randomUUID } = require('node:crypto');
const restore = require('../utils/restore');
const audit = require('../utils/audit');
const activeRestores = require('../utils/backup-lock');
const upload = require('../utils/backup-upload');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('backup').setDescription('Export a server configuration snapshot (administrators).')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('upload').setDescription('Replace channels using a secret backup code (destructive).'))
    .addSubcommand((s) => s.setName('export').setDescription('Download a private JSON snapshot of roles and channels.'))
    .addSubcommand((s) => s.setName('restore').setDescription('Preview a safe additive roles/channels restore (administrator).').addAttachmentOption((o) => o.setName('snapshot').setDescription('JSON export from /backup export').setRequired(true))),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use the Slash Command', 'For privacy, use `/backup` slash commands.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Administrator Only', 'You need the Administrator permission.')));
    if (interaction.options.getSubcommand() === 'upload') return upload(interaction);
    await interaction.deferReply({ flags: 64 });
    const { guild } = interaction;
    if (interaction.options.getSubcommand() === 'restore') {
      const me = guild.members.me ?? await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.Administrator)) return interaction.editReply({ embeds: [embeds.error(interaction, 'Bot Administrator Required', 'Safe restore requires the bot to have Administrator permission.')] });
      let blueprint;
      try { blueprint = await restore.readSnapshot(interaction.options.getAttachment('snapshot', true)); }
      catch (err) { return interaction.editReply({ embeds: [embeds.error(interaction, 'Invalid Snapshot', err.message.slice(0, 300))] }); }
      const confirmId = `backup_confirm_${randomUUID()}`;
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('Create safe skeleton').setStyle(ButtonStyle.Danger));
      const prompt = `Create **${blueprint.roles.length} new roles** and **${blueprint.channels.length} new channels** in **this server**. Skipped: ${blueprint.skippedRoles} roles, ${blueprint.skippedChannels} unsupported channels.\n\n**No existing items are deleted.** New roles have **no permissions**; new channels are **private to admins**. Saved overwrites, settings, member roles and messages are NOT restored. Repeating creates duplicates. Check and configure access manually.\n\nConfirm within 60 seconds.`;
      const message = await interaction.editReply({ embeds: [embeds.warn(interaction, 'Preview Safe Restore', prompt)], components: [row] });
      let click;
      try { click = await message.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (c) => c.customId === confirmId && c.user.id === interaction.user.id }); }
      catch { return interaction.editReply({ embeds: [embeds.warn(interaction, 'Restore Expired', 'Nothing was changed.')], components: [] }); }
      if (!click.memberPermissions?.has(PermissionFlagsBits.Administrator)) return click.update({ embeds: [embeds.error(interaction, 'Permission Changed', 'Administrator permission is required. Nothing was changed.')], components: [] });
      if (activeRestores.has(guild.id)) return click.update({ embeds: [embeds.warn(interaction, 'Restore In Progress', 'Another restore is already running. Try again after it finishes.')], components: [] });
      activeRestores.add(guild.id);
      let result;
      try {
        await click.update({ embeds: [embeds.loading(interaction, 'Restoring safe skeleton')], components: [] });
        result = await restore.apply(guild, blueprint);
      } finally { activeRestores.delete(guild.id); }
      audit.record(guild.id, interaction.user.id, 'backup.restore', `${result.roles} roles, ${result.channels} channels`);
      return interaction.editReply({ embeds: [embeds.make(interaction, { title: 'Restore Finished', description: `Created **${result.roles} roles** and **${result.channels} channels**. New channels are private to administrators; permissions and member roles must be configured manually.\n${result.errors.length ? `\n**${result.errors.length} items failed:**\n${result.errors.slice(0, 5).join('\n').slice(0, 1000)}` : ''}` })], components: [] });
    }
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
