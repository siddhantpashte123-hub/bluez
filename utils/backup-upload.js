const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits } = require('discord.js');
const { randomUUID } = require('node:crypto');
const backup = require('./channel-backup');
const locks = require('./backup-lock');
const embeds = require('./embeds');

async function upload(interaction) {
  const modalId = `backup_code_${randomUUID()}`;
  const modal = new ModalBuilder().setCustomId(modalId).setTitle('Enter your secret backup code')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel('Backup code').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(43).setMaxLength(43)));
  await interaction.showModal(modal);
  let submission;
  try { submission = await interaction.awaitModalSubmit({ time: 120_000, filter: i => i.customId === modalId && i.user.id === interaction.user.id }); }
  catch { return; }
  if (!submission.memberPermissions?.has(PermissionFlagsBits.Administrator)) return submission.reply(embeds.ephemeral(embeds.error(submission, 'Administrator Only', 'Nothing was changed.')));
  await submission.deferReply({ flags: 64 });
  const guild = interaction.guild;
  let snapshot, existing;
  try {
    snapshot = backup.load(submission.fields.getTextInputValue('code').trim());
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.Administrator)) throw new Error('The bot needs Administrator permission.');
    existing = backup.checkTarget(guild, snapshot, await guild.channels.fetch());
  } catch (err) { return submission.editReply({ embeds: [embeds.error(submission, 'Cannot Restore', err.message.slice(0, 300))] }); }
  const id = `backup_replace_${randomUUID()}`;
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel('Delete channels and restore').setStyle(ButtonStyle.Danger));
  const text = `Target: **${guild.name.replace(/[*_`~\\]/g, '\\$&').slice(0, 100)}** (ID: ${guild.id})\nDelete **${existing.length} existing channels/categories** and create **${snapshot.channels.length}** from the backup.\n\n**All messages and threads in deleted channels will be permanently lost. This cannot be undone.** Roles, settings, messages and permissions are not restored. New channels are private to administrators until configured. Channel IDs change; bot features pointing to old channels may break.\n\nThe process can partially fail; no automatic rollback. Enable DMs for the result. Confirm within 60 seconds.`;
  const message = await submission.editReply({ embeds: [embeds.warn(submission, 'Danger: Replace Server Channels', text)], components: [row] });
  let click;
  try { click = await message.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: c => c.customId === id && c.user.id === interaction.user.id }); }
  catch { return submission.editReply({ embeds: [embeds.warn(submission, 'Restore Expired', 'Nothing was changed.')], components: [] }); }
  if (!click.memberPermissions?.has(PermissionFlagsBits.Administrator)) return click.update({ embeds: [embeds.error(submission, 'Permission Changed', 'Administrator permission required. Nothing was changed.')], components: [] });
  if (locks.has(guild.id)) return click.update({ embeds: [embeds.warn(submission, 'Restore In Progress', 'Another restore is already running.')], components: [] });
  locks.add(guild.id);
  let dmStarted = false;
  try {
    await click.update({ embeds: [embeds.loading(submission, 'Checking and replacing channels')], components: [] });
    const [member, me, fresh] = await Promise.all([guild.members.fetch(interaction.user.id), guild.members.fetchMe(), guild.channels.fetch()]);
    if (!member.permissions.has(PermissionFlagsBits.Administrator) || !me.permissions.has(PermissionFlagsBits.Administrator)) throw new Error('Administrator permission changed. Nothing was changed.');
    const current = backup.checkTarget(guild, snapshot, fresh);
    const ids = list => list.map(c => c.id).sort().join(',');
    if (ids(current) !== ids(existing)) throw new Error('The channel list changed since preview. Nothing was changed; start again.');
    try { await interaction.user.send({ content: `Channel replacement is starting in ${guild.name} (ID: ${guild.id}). A result will be sent here. This operation may partially fail.`, allowedMentions: { parse: [] } }); dmStarted = true; }
    catch { throw new Error('Enable DMs from server members and try again. Nothing was changed.'); }
    const result = await backup.replace(guild, snapshot, current, interaction.channelId);
    const summary = `Channel replacement in ${guild.name} (ID: ${guild.id}): deleted ${result.deleted}/${current.length}, created ${result.created}/${snapshot.channels.length}. ${result.stopped ? 'Stopped on deletion failure; no new channels were created.' : 'New channels are private to administrators; configure permissions manually.'}${result.errors.length ? `\nFailures (${result.errors.length}):\n${result.errors.slice(0, 8).join('\n').slice(0, 900)}` : ''}`;
    // The command channel might already be deleted; DM is the primary result channel.
    await interaction.user.send({ content: summary.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
    await submission.editReply({ embeds: [embeds.info(submission, 'Channel Replacement Result', summary.slice(0, 1900))], components: [] }).catch(() => {});
  } catch (err) {
    const text = `Channel replacement stopped in ${guild.name}: ${err.message.slice(0, 300)}`;
    if (dmStarted) await interaction.user.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
    await submission.editReply({ embeds: [embeds.error(submission, 'Restore Stopped', text)], components: [] }).catch(() => {});
  } finally { locks.delete(guild.id); }
}
module.exports = upload;
