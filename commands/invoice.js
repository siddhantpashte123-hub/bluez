/** Private manual invoice workflow: form -> recipient selector -> branded image DM. */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, ComponentType, AttachmentBuilder, escapeMarkdown } = require('discord.js');
const { randomUUID, randomBytes } = require('node:crypto');
const embeds = require('../utils/embeds');
const invoice = require('../utils/invoice');
const cards = require('../utils/cards');
const branding = require('../utils/branding');

module.exports = {
  data: new SlashCommandBuilder().setName('invoice').setDescription('Create a manual invoice and DM a server member (Manage Server).')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'For a private form and recipient selection, use `/invoice`.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Missing Permission', 'Manage Server is required.')));
    const modalId = `invoice_form_${randomUUID()}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('Create a manual invoice').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('product').setLabel('Product name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('Price in INR (e.g. 499.00)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(11)),
    );
    await interaction.showModal(modal);
    let form;
    try { form = await interaction.awaitModalSubmit({ time: 120_000, filter: s => s.customId === modalId && s.user.id === interaction.user.id }); }
    catch { return; }
    if (!form.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return form.reply(embeds.ephemeral(embeds.error(form, 'Permission Changed', 'Manage Server is required. Nothing was sent.')));
    await form.deferReply({ flags: 64 });
    let product, amount;
    const guild = interaction.guild;
    try {
      product = invoice.productName(form.fields.getTextInputValue('product'));
      amount = invoice.formatPrice(invoice.parsePrice(form.fields.getTextInputValue('price')));
      if (!cards.available()) throw new Error('Invoice images are unavailable. Install the optional canvas dependency on the VPS.');
      if (!guild.iconURL({ extension: 'png', forceStatic: true, size: 256 })) throw new Error('This server has no logo. Set a server icon before sending an invoice.');
    } catch (err) {
      return form.editReply({ embeds: [embeds.error(form, 'Cannot Create Invoice', err.message.slice(0, 300))], components: [] });
    }
    const selectId = `invoice_to_${randomUUID()}`;
    const row = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(selectId).setPlaceholder('Select one server member to send the invoice').setMinValues(1).setMaxValues(1));
    const prompt = embeds.make(form, { title: '🧾 Choose Invoice Recipient', description: 'Select one **member of this server**. Selecting them will send this invoice to their DMs immediately. The invoice is not a payment receipt.', fields: [{ name: 'Product', value: product }, { name: 'Amount', value: amount }] });
    const message = await form.editReply({ embeds: [prompt], components: [row], allowedMentions: { parse: [] } });
    let selection;
    try { selection = await message.awaitMessageComponent({ componentType: ComponentType.UserSelect, time: 120_000, filter: c => c.customId === selectId && c.user.id === interaction.user.id }); }
    catch { return form.editReply({ embeds: [embeds.warn(form, 'Invoice Expired', 'No recipient was selected. Nothing was sent.')], components: [] }); }
    if (!selection.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return selection.update({ embeds: [embeds.error(form, 'Permission Changed', 'Manage Server is required. Nothing was sent.')], components: [] });
    await selection.update({ embeds: [embeds.loading(form, 'Preparing your invoice')], components: [] });
    let member;
    try {
      const issuer = await guild.members.fetch(interaction.user.id);
      if (!issuer.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('Your Manage Server permission is no longer available. Nothing was sent.');
      if (selection.values.length !== 1 || !/^\d{16,20}$/.test(selection.values[0])) throw new Error('Select one valid server member. Nothing was sent.');
      member = await guild.members.fetch(selection.values[0]).catch(() => null);
      if (!member?.user || member.user.bot) throw new Error('The selected user must be a human member of this server. Nothing was sent.');
    } catch (err) { return form.editReply({ embeds: [embeds.error(form, 'Cannot Send Invoice', err.message.slice(0, 300))], components: [] }); }
    const invoiceId = `INV-${randomBytes(8).toString('hex').toUpperCase()}`;
    const date = new Date().toISOString().slice(0, 10);
    let image, currentGuild;
    try {
      // Fetch the current name and icon after selection so the two match.
      currentGuild = await guild.fetch();
      const icon = await invoice.fetchIcon(currentGuild);
      image = await cards.invoiceCard({ serverName: currentGuild.name, icon, product, amount, invoiceId, date, recipientId: member.id, accent: branding.accent(guild.id) });
      if (!image) throw new Error('Image generation is unavailable.');
    } catch { return form.editReply({ embeds: [embeds.error(form, 'Invoice Image Failed', 'Could not load the current server name and logo or render the invoice. Nothing was sent.')], components: [] }); }
    const description = `Invoice ${invoiceId}. Server: ${currentGuild.name}. Product: ${product}. Amount: ${amount}. Recipient ID: ${member.id}. Payment not verified.`;
    const content = `🧾 **Invoice from ${escapeMarkdown(currentGuild.name)}**\n**Product:** ${escapeMarkdown(product)}  •  **Total:** ${amount}\n-# Invoice ${invoiceId}  •  Server ${guild.id}  •  Issuer ${interaction.user.id}\n-# Payment is not verified. This is not a receipt; check with server staff.`;
    try {
      await member.user.send({ content, files: [new AttachmentBuilder(image, { name: `${invoiceId}.png`, description: description.slice(0, 1024) })], allowedMentions: { parse: [] } });
    } catch {
      return form.editReply({ embeds: [embeds.error(form, 'DM Delivery Not Confirmed', 'The recipient may have DMs disabled. Check with them before retrying; the invoice was not posted to a server channel.')], components: [] });
    }
    return form.editReply({ embeds: [embeds.success(form, 'Invoice Sent', `The invoice was sent privately to <@${member.id}>. Payment was not verified.`)], components: [], allowedMentions: { parse: [] } });
  },
};
