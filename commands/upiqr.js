/**
 * /upiqr <amount> [upi_id] [name] — uses the caller’s saved UPI ID by default
 * Generates UPI payment QR codes with @omkarbhosale/upiqr.
 * Amounts above ₹2,000 are automatically split into several QR codes
 * (₹1,999 chunks), each shown in its own embed.
 */
const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');
const QRCode = require('qrcode');
const settings = require('../utils/upi-settings');

const SPLIT_ABOVE = 2000; // ₹ – anything above this is split
const MAX_AMOUNT = 50000; // ₹ – keeps the number of QR codes sensible (max 26)
const EMBEDS_PER_MESSAGE = 10; // Discord's hard limit
const QR_WIDTH = 640; // crisp, larger QR with a four-module quiet zone

/** @omkarbhosale/upiqr is an ES module, so it is loaded with import() once. */
let upiqrModule;
const loadUpiqr = async () => (upiqrModule ??= await import('@omkarbhosale/upiqr'));

/** ₹ formatting, e.g. 1999 -> ₹1,999 | 1002.5 -> ₹1,002.50 */
const rupees = (n) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** upi://pay intent link (opens the UPI app on a phone). */
function upiLink(upiId, amount, name, note) {
  const params = new URLSearchParams({ pa: upiId, am: Number.isInteger(amount) ? `${amount}` : amount.toFixed(2), cu: 'INR' });
  if (name) params.set('pn', name);
  if (note) params.set('tn', note);
  return `upi://pay?${params.toString()}`;
}

/** "data:image/png;base64,AAAA" -> Buffer */
const dataUrlToBuffer = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

/**
 * Build the QR message(s) for a payment. Used by /upiqr and by /shop buy.
 * Returns an array of message payloads ({ embeds, files }), max 10 embeds each.
 * Throws when the UPI ID or amount is invalid.
 */
async function buildQrPayloads(ctx, upiId, amount, name, note = '') {
  // Match the payment library's trimming so the displayed link and fallback QR agree.
  if (typeof upiId === 'string') upiId = upiId.trim();
  if (typeof name === 'string') name = name.trim();
  if (typeof note === 'string') note = note.trim();
  const { generateQR, splitTransactionQR } = await loadUpiqr();
  const parts =
    amount > SPLIT_ABOVE
      ? await splitTransactionQR({ UPI_ID: upiId, AMOUNT: amount, name, note })
      : [{ amount, image: await generateQR({ UPI_ID: upiId, AMOUNT: amount, name, note }) }];

  const total = parts.length;
  const items = await Promise.all(parts.map(async (part, i) => {
    const fileName = `upi-qr-${i + 1}.png`;
    const partNote = note && total > 1 ? `${note} (Part ${i + 1}/${total})` : note;
    const link = upiLink(upiId, part.amount, name, partNote);
    const embed = embeds.make(ctx, {
      color: embeds.COLORS.cyan,
      title: total > 1 ? `💸 UPI Payment — QR ${i + 1} of ${total}` : '💸 UPI Payment QR',
      description:
        `### ${rupees(part.amount)}\n` +
        (total > 1 && i === 0
          ? `The total of **${rupees(amount)}** is above ${rupees(SPLIT_ABOVE)}, so it was split into **${total}** payments. Please scan **every** QR code.\n\n`
          : '') +
        'Scan with GPay, PhonePe, Paytm or another UPI app.\n**Check the recipient and amount in your UPI app before paying.**',
      fields: [
        { name: '🏦 UPI ID', value: `\`${upiId}\``, inline: true },
        { name: '💰 Amount', value: `**${rupees(part.amount)}**`, inline: true },
        { name: '👤 Payee Name', value: name || 'Not specified', inline: true },
        ...(partNote ? [{ name: '📝 Payment Note', value: partNote }] : []),
        { name: '📲 Pay Now (UPI link)', value: link.length <= 1018 ? `\`\`\`${link}\`\`\`` : 'Link is too long to display; scan the QR instead.' },
      ],
      image: `attachment://${fileName}`,
      thumbnail: false,
      footer: total > 1 ? `Part ${i + 1}/${total} • Total ${rupees(amount)} • Check every payment` : 'Verify the recipient before paying',
    });
    // Encode the same exact UPI URI shown in the embed. Keep a clean white quiet
    // zone and high contrast; no logo or artwork should obscure the QR modules.
    let image;
    try {
      image = await QRCode.toBuffer(link, { width: QR_WIDTH, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#00385EFF', light: '#FFFFFFFF' } });
    } catch (err) {
      console.warn('[UPI QR] High-resolution rendering failed; using original QR:', err.message);
      image = dataUrlToBuffer(part.image);
    }
    return { embed, file: new AttachmentBuilder(image, { name: fileName }) };
  }));

  // Discord limits both the embed count and total text across a message.
  const payloads = [];
  let chunk = [], characters = 0;
  for (const item of items) {
    if (chunk.length && (chunk.length >= EMBEDS_PER_MESSAGE || characters + item.embed.length > 6000)) {
      payloads.push({ embeds: chunk.map(c => c.embed), files: chunk.map(c => c.file) });
      chunk = []; characters = 0;
    }
    chunk.push(item); characters += item.embed.length;
  }
  if (chunk.length) payloads.push({ embeds: chunk.map(c => c.embed), files: chunk.map(c => c.file) });
  return payloads;
}

module.exports = {
  buildQrPayloads,
  rupees,

  data: new SlashCommandBuilder()
    .setName('upiqr')
    .setDescription('💸 Generate a UPI payment QR code.')
    .setContexts(InteractionContextType.Guild)
    .addNumberOption((o) => o.setName('amount').setDescription('Amount in ₹').setRequired(true).setMinValue(1).setMaxValue(MAX_AMOUNT))
    .addStringOption((o) => o.setName('upi_id').setDescription('Override your saved UPI ID').setMinLength(3).setMaxLength(50))
    .addStringOption((o) => o.setName('name').setDescription('Optional payee name').setMaxLength(60))
    .addStringOption((o) => o.setName('note').setDescription('Optional payment note, visible to the payer').setMaxLength(85)),

  async execute(interaction) {
    const override = interaction.options.getString('upi_id')?.trim() ?? '';
    const suppliedName = interaction.options.getString('name');
    const amount = Math.round(interaction.options.getNumber('amount', true) * 100) / 100;
    const note = (interaction.options.getString('note') ?? '').trim();
    let saved = null;
    try { if (!override) saved = settings.get(interaction.guildId ?? interaction.guild.id, interaction.user.id); }
    catch { return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'UPI Settings Unavailable', 'Saved UPI settings could not be read. Check bot storage or provide a UPI ID explicitly.'))); }
    const upiId = override || saved?.upiId;
    if (!upiId) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Set Your UPI ID First', 'Use `/upiset upi_id:name@bank`, or provide `upi_id` explicitly.')));
    const name = suppliedName != null ? suppliedName.trim() : (override ? '' : saved?.name ?? '');
    if (!settings.validId(upiId) || !Number.isFinite(amount) || amount < 1 || amount > MAX_AMOUNT || name.length > 60 || note.length > 85) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Payment Details', 'Use a valid UPI ID and an amount from ₹1 to ₹50,000.')));

    await interaction.reply({ embeds: [embeds.loading(interaction, 'Generating UPI QR code...')] });

    let payloads;
    try {
      payloads = await buildQrPayloads(interaction, upiId, amount, name, note);
    } catch (err) {
      console.error('[/upiqr]', err.message);
      const invalid = /validation/i.test(err.message);
      return interaction.editReply({
        embeds: [
          embeds.error(
            interaction,
            invalid ? 'Invalid Payment Details' : 'QR Generation Failed',
            invalid
              ? `${String(err.message).replace(/^Validation error:\s*/i, '').slice(0, 500)}\n\nExample: \`/upiqr amount:499 upi_id:name@bank\``
              : 'Something went wrong while generating the QR code. Please try again.',
          ),
        ],
      });
    }

    // The first message replaces the loading embed, the rest are follow-ups.
    await interaction.editReply(payloads[0]);
    for (const payload of payloads.slice(1)) await interaction.followUp(payload);
    return undefined;
  },
};
