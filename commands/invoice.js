/** Private manual invoice workflow and staff-only history. */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, ComponentType, AttachmentBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { randomUUID, randomBytes } = require('node:crypto');
const embeds = require('../utils/embeds');
const invoice = require('../utils/invoice');
const store = require('../utils/invoice-store');
const cards = require('../utils/cards');
const branding = require('../utils/branding');

const ID_PATTERN = /^INV-[A-F0-9]{16}$/;
function statusLabel(record) { return record.status === 'paid' ? 'Paid (staff marked, not verified)' : 'Unpaid (staff marked, not verified)'; }
function summary(record) {
  const rows = record.items.map(item => `• ${escapeMarkdown(item.name)} — ${item.quantity} × ${invoice.formatPrice(item.unitPaise)} = ${invoice.formatPrice(item.quantity * item.unitPaise)}`);
  return `🧾 **Invoice from ${escapeMarkdown(record.serverName)}**\n${rows.join('\n')}\n**Total:** ${invoice.formatPrice(record.totalPaise)}\n${record.note ? `**Note:** ${escapeMarkdown(record.note)}\n` : ''}**Status:** ${statusLabel(record)}\n-# Invoice ${record.id} • Server ${record.guildId} • Issuer ${record.issuerId}\n-# Payment is not verified. This is not a receipt; check with server staff.`;
}
async function render(guild, record, currentGuild = null) {
  if (!cards.available()) throw new Error('Invoice images are unavailable. Install the optional canvas dependency on the VPS.');
  currentGuild ??= await guild.fetch();
  const icon = await invoice.fetchIcon(currentGuild);
  const image = await cards.invoiceDetailedCard({ serverName: record.serverName, icon, items: record.items, totalPaise: record.totalPaise, note: record.note, invoiceId: record.id, date: record.createdAt.slice(0, 10), recipientId: record.recipientId, status: record.status, accent: branding.accent(guild.id) });
  if (!image) throw new Error('Invoice image generation is unavailable.');
  return image;
}
function attachment(record, image) {
  return new AttachmentBuilder(image, { name: `${record.id}.png`, description: `Invoice ${record.id}; ${record.items.length} items; total ${invoice.formatPrice(record.totalPaise)}; recipient ${record.recipientId}. Payment not verified.` });
}
async function authorizedMember(guild, issuerId, recipientId) {
  const issuer = await guild.members.fetch({ user: issuerId, force: true });
  if (!issuer.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('Your Manage Server permission is no longer available.');
  if (!/^\d{16,20}$/.test(recipientId)) throw new Error('Select a valid server member.');
  const member = await guild.members.fetch({ user: recipientId, force: true }).catch(() => null);
  if (!member?.user || member.user.bot) throw new Error('The recipient must be a human member of this server.');
  return member;
}
function errorReply(ctx, title, text) { return embeds.ephemeral(embeds.error(ctx, title, text)); }
async function manage(interaction, action) {
  const guildId = interaction.guildId, id = (interaction.options.getString('invoice_id') ?? '').trim().toUpperCase();
  const paymentStatus = interaction.options.getString('payment_status');
  const page = interaction.options.getInteger('page');
  if (action === 'history') {
    if (id || paymentStatus) return interaction.reply(errorReply(interaction, 'Invalid Options', 'History uses only the optional page number.'));
    try {
      const all = store.list(guildId), current = page ?? 1, pages = Math.max(1, Math.ceil(all.length / 10));
      if (current < 1 || current > pages) return interaction.reply(errorReply(interaction, 'Invalid Page', `Choose a page from 1 to ${pages}.`));
      const records = all.slice((current - 1) * 10, current * 10);
      const description = records.length ? records.map(r => `**${r.id}** • ${r.createdAt.slice(0, 10)} • ${invoice.formatPrice(r.totalPaise)}\nRecipient: ${r.recipientId} • ${statusLabel(r)} • Delivery: ${r.delivery}`).join('\n\n') : 'No saved invoices in this server yet.';
      return interaction.reply({ ...embeds.ephemeral(embeds.make(interaction, { title: '🧾 Invoice History', description: `${description}\n\nPage ${current}/${pages}. Payment is never verified by the bot.` })), allowedMentions: { parse: [] } });
    } catch { return interaction.reply(errorReply(interaction, 'History Unavailable', 'Could not read invoice history. Check bot storage.')); }
  }
  if (page != null) return interaction.reply(errorReply(interaction, 'Invalid Options', 'Page is only used with history.'));
  if (action === 'view') {
    if (!ID_PATTERN.test(id) || paymentStatus) return interaction.reply(errorReply(interaction, 'Invalid Options', 'View requires a valid invoice_id and no payment_status.'));
    try {
      const record = store.get(guildId, id);
      if (!record) return interaction.reply(errorReply(interaction, 'Not Found', 'No invoice with that ID exists in this server.'));
      return interaction.reply({ content: `${summary(record)}\n**Recipient ID:** ${record.recipientId} • **Delivery:** ${record.delivery}`, flags: 64, allowedMentions: { parse: [] } });
    } catch { return interaction.reply(errorReply(interaction, 'History Unavailable', 'Could not read invoice history. Check bot storage.')); }
  }
  if (!ID_PATTERN.test(id)) return interaction.reply(errorReply(interaction, 'Invoice ID Required', 'Enter a valid invoice_id from the invoice or history.'));
  if (!['status', 'resend'].includes(action)) return interaction.reply(errorReply(interaction, 'Invalid Action', 'Choose history, resend or status.'));
  if (action === 'status' && !['paid', 'unpaid'].includes(paymentStatus)) return interaction.reply(errorReply(interaction, 'Status Required', 'Choose paid or unpaid for payment_status.'));
  if (action === 'resend' && paymentStatus) return interaction.reply(errorReply(interaction, 'Invalid Options', 'Resend does not use payment_status.'));
  if (action === 'status') {
    try {
      const record = store.update(guildId, id, { status: paymentStatus, statusBy: interaction.user.id, statusAt: new Date().toISOString() });
      if (!record) return interaction.reply(errorReply(interaction, 'Not Found', 'No invoice with that ID exists in this server.'));
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Manual Status Updated', `${id}: ${statusLabel(record)}. The recipient was not notified; use resend to share the updated invoice. This is not payment verification.`)));
    } catch { return interaction.reply(errorReply(interaction, 'Status Not Saved', 'Could not update invoice history. Check bot storage.')); }
  }
  await interaction.deferReply({ flags: 64 });
  let record, image, member;
  try {
    record = store.get(guildId, id);
    if (!record) throw new Error('No invoice with that ID exists in this server.');
    member = await authorizedMember(interaction.guild, interaction.user.id, record.recipientId);
    image = await render(interaction.guild, record);
    member = await authorizedMember(interaction.guild, interaction.user.id, record.recipientId);
    if (store.get(guildId, id)?.status !== record.status) throw new Error('Invoice status changed. Retry the resend.');
    // Record the attempt before sending, so a crash or timeout is never treated as confirmed delivery.
    store.update(guildId, id, { delivery: 'uncertain' });
  } catch (err) {
    return interaction.editReply({ embeds: [embeds.error(interaction, 'Cannot Resend Invoice', 'Could not prepare the saved invoice, verify permissions and recipient, or update storage. Nothing was sent. Check the server icon and storage, then try again.')], components: [] });
  }
  try { await member.user.send({ content: summary(record), files: [attachment(record, image)], allowedMentions: { parse: [] } }); }
  catch { return interaction.editReply({ embeds: [embeds.error(interaction, 'Resend Not Confirmed', 'Delivery is uncertain. Ask the recipient before retrying to avoid duplicate DMs. No message was posted publicly.')], components: [] }); }
  try { store.update(guildId, id, { delivery: 'sent', lastSentAt: new Date().toISOString() }); }
  catch { return interaction.editReply({ embeds: [embeds.warn(interaction, 'Sent, History Not Updated', 'The DM was sent, but its delivery record could not be updated. Check bot storage before retrying.')], components: [] }); }
  return interaction.editReply({ embeds: [embeds.success(interaction, 'Invoice Resent', `${id} was sent privately to <@${member.id}>. Payment was not verified.`)], allowedMentions: { parse: [] }, components: [] });
}
module.exports = {
  data: new SlashCommandBuilder().setName('invoice').setDescription('Create or manage private manual invoices (Manage Server).')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('action').setDescription('Leave empty to create an invoice').addChoices({ name: 'History', value: 'history' }, { name: 'View', value: 'view' }, { name: 'Resend', value: 'resend' }, { name: 'Set manual status', value: 'status' }))
    .addStringOption(o => o.setName('invoice_id').setDescription('Invoice ID for view, resend or status').setMaxLength(20))
    .addStringOption(o => o.setName('payment_status').setDescription('Manual status; not payment verification').addChoices({ name: 'Paid (manual)', value: 'paid' }, { name: 'Unpaid (manual)', value: 'unpaid' }))
    .addIntegerOption(o => o.setName('page').setDescription('History page number').setMinValue(1)),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'Invoice forms and history are private. Use `/invoice`.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply(errorReply(interaction, 'Missing Permission', 'Manage Server is required.'));
    const action = interaction.options?.getString('action');
    if (action) return manage(interaction, action);
    if (interaction.options?.getString('invoice_id') || interaction.options?.getString('payment_status') || interaction.options?.getInteger('page') != null) return interaction.reply(errorReply(interaction, 'Invalid Options', 'Choose an action for invoice_id, payment_status or page.'));
    const modalId = `invoice_form_${randomUUID()}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('Create a manual invoice').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('product').setLabel('First product name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('First item unit price in INR').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(11)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('quantity').setLabel('First item quantity (default 1)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extra').setLabel('Extra items: name | quantity | price').setPlaceholder('One per line, up to 4 extra items').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Note / payment instructions (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)),
    );
    await interaction.showModal(modal);
    let form;
    try { form = await interaction.awaitModalSubmit({ time: 120_000, filter: s => s.customId === modalId && s.user.id === interaction.user.id }); } catch { return; }
    if (!form.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return form.reply(errorReply(form, 'Permission Changed', 'Manage Server is required. Nothing was sent.'));
    await form.deferReply({ flags: 64 });
    let parsed, note; const guild = interaction.guild;
    try {
      parsed = invoice.parseItems(...['product', 'price', 'quantity', 'extra'].map(k => form.fields.getTextInputValue(k)));
      note = invoice.noteText(form.fields.getTextInputValue('note'));
      if (!cards.available()) throw new Error('Invoice images are unavailable. Install the optional canvas dependency on the VPS.');
      if (!guild.iconURL({ extension: 'png', forceStatic: true, size: 256 })) throw new Error('This server has no logo. Set a server icon before sending an invoice.');
    } catch (err) { return form.editReply({ embeds: [embeds.error(form, 'Cannot Create Invoice', err.message.slice(0, 300))], components: [] }); }
    const selectId = `invoice_to_${randomUUID()}`;
    const row = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(selectId).setPlaceholder('Select one server member').setMinValues(1).setMaxValues(1));
    const prompt = embeds.make(form, { title: '🧾 Choose Invoice Recipient', description: `Select one human server member. You will preview and confirm before any DM is sent.\n**Items:** ${parsed.items.length} • **Total:** ${invoice.formatPrice(parsed.totalPaise)}` });
    const message = await form.editReply({ embeds: [prompt], components: [row], allowedMentions: { parse: [] } });
    let selection;
    try { selection = await message.awaitMessageComponent({ componentType: ComponentType.UserSelect, time: 120_000, filter: c => c.customId === selectId && c.user.id === interaction.user.id }); }
    catch { return form.editReply({ embeds: [embeds.warn(form, 'Invoice Expired', 'No recipient was selected. Nothing was sent.')], components: [] }); }
    if (!selection.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return selection.update({ embeds: [embeds.error(form, 'Permission Changed', 'Manage Server is required. Nothing was sent.')], components: [] });
    await selection.update({ embeds: [embeds.loading(form, 'Preparing your private preview')], components: [] });
    let record, image;
    try {
      if (selection.values.length !== 1) throw new Error('Select one member.');
      const member = await authorizedMember(guild, interaction.user.id, selection.values[0]);
      const currentGuild = await guild.fetch();
      record = { id: `INV-${randomBytes(8).toString('hex').toUpperCase()}`, guildId: guild.id, serverName: currentGuild.name, issuerId: interaction.user.id, recipientId: member.id, ...parsed, note, status: 'unpaid', delivery: 'uncertain', createdAt: new Date().toISOString() };
      image = await render(guild, record, currentGuild);
    } catch (err) { return form.editReply({ embeds: [embeds.error(form, 'Cannot Prepare Invoice', `${err.message.slice(0, 250)} Nothing was sent.`)], components: [] }); }
    const confirmId = `invoice_confirm_${randomUUID()}`, cancelId = `invoice_cancel_${randomUUID()}`;
    const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm & Send DM').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    const preview = await form.editReply({ content: `**Private preview — recipient:** <@${record.recipientId}>\n${summary(record)}`, embeds: [], files: [attachment(record, image)], components: [buttons], allowedMentions: { parse: [] } });
    let decision;
    try { decision = await preview.awaitMessageComponent({ componentType: ComponentType.Button, time: 120_000, filter: c => [confirmId, cancelId].includes(c.customId) && c.user.id === interaction.user.id }); }
    catch { return form.editReply({ content: null, embeds: [embeds.warn(form, 'Invoice Expired', 'Preview expired. Nothing was sent.')], attachments: [], components: [] }); }
    if (decision.customId === cancelId) return decision.update({ content: null, embeds: [embeds.warn(form, 'Invoice Cancelled', 'Nothing was sent or saved.')], attachments: [], components: [] });
    if (!decision.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return decision.update({ content: null, embeds: [embeds.error(form, 'Permission Changed', 'Manage Server is required. Nothing was sent.')], attachments: [], components: [] });
    await decision.update({ content: null, embeds: [embeds.loading(form, 'Sending invoice')], attachments: [], components: [] });
    let member;
    try { member = await authorizedMember(guild, interaction.user.id, record.recipientId); }
    catch (err) { return form.editReply({ embeds: [embeds.error(form, 'Cannot Send Invoice', `${err.message.slice(0, 250)} Nothing was sent.`)], components: [] }); }
    try { store.create(guild.id, record); }
    catch { return form.editReply({ embeds: [embeds.error(form, 'Invoice Not Sent', 'Could not save the invoice to private history. Check bot storage.')], components: [] }); }
    try { await member.user.send({ content: summary(record), files: [attachment(record, image)], allowedMentions: { parse: [] } }); }
    catch { return form.editReply({ embeds: [embeds.error(form, 'DM Delivery Not Confirmed', `Invoice ${record.id} is saved with uncertain delivery. Check with the recipient before retrying; nothing was posted publicly.`)], components: [] }); }
    try { store.update(guild.id, record.id, { delivery: 'sent', lastSentAt: new Date().toISOString() }); }
    catch { return form.editReply({ embeds: [embeds.warn(form, 'Sent, History Not Updated', `Invoice ${record.id} was sent, but its delivery status could not be updated. Check storage before retrying.`)], components: [] }); }
    return form.editReply({ embeds: [embeds.success(form, 'Invoice Sent', `${record.id} was sent privately to <@${member.id}>. Payment was not verified.`)], components: [], allowedMentions: { parse: [] } });
  },
};
