/**
 * /upiqr <upi_id> <amount> <name>
 * Generates UPI payment QR codes with @omkarbhosale/upiqr.
 * Amounts above ₹2,000 are automatically split into several QR codes
 * (₹1,999 chunks), each shown in its own embed.
 */
const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');

const SPLIT_ABOVE = 2000; // ₹ – anything above this is split
const MAX_AMOUNT = 50000; // ₹ – keeps the number of QR codes sensible (max 26)
const EMBEDS_PER_MESSAGE = 10; // Discord's hard limit

/** @omkarbhosale/upiqr is an ES module, so it is loaded with import() once. */
let upiqrModule;
const loadUpiqr = async () => (upiqrModule ??= await import('@omkarbhosale/upiqr'));

/** ₹ formatting, e.g. 1999 -> ₹1,999 | 1002.5 -> ₹1,002.50 */
const rupees = (n) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** upi://pay intent link (opens the UPI app on a phone). */
function upiLink(upiId, amount, name) {
  const params = new URLSearchParams({ pa: upiId, pn: name, am: Number.isInteger(amount) ? `${amount}` : amount.toFixed(2), cu: 'INR' });
  return `upi://pay?${params.toString()}`;
}

/** "data:image/png;base64,AAAA" -> Buffer */
const dataUrlToBuffer = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upiqr')
    .setDescription('💸 Generate a UPI payment QR code.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('upi_id').setDescription('UPI ID, e.g. name@bank').setRequired(true).setMinLength(3).setMaxLength(50))
    .addNumberOption((o) => o.setName('amount').setDescription('Amount in ₹').setRequired(true).setMinValue(1).setMaxValue(MAX_AMOUNT))
    .addStringOption((o) => o.setName('name').setDescription('Payee name').setRequired(true).setMaxLength(60)),

  async execute(interaction) {
    const upiId = interaction.options.getString('upi_id', true).trim();
    const amount = Math.round(interaction.options.getNumber('amount', true) * 100) / 100;
    const name = interaction.options.getString('name', true).trim();

    await interaction.reply({ embeds: [embeds.loading(interaction, 'Generating UPI QR code...')] });

    // ---- Generate the QR code(s) ----
    let parts; // [{ amount, image(dataURL) }]
    try {
      const { generateQR, splitTransactionQR } = await loadUpiqr();
      if (amount > SPLIT_ABOVE) {
        parts = await splitTransactionQR({ UPI_ID: upiId, AMOUNT: amount, name });
      } else {
        parts = [{ amount, image: await generateQR({ UPI_ID: upiId, AMOUNT: amount, name }) }];
      }
    } catch (err) {
      console.error('[/upiqr]', err.message);
      const invalid = /validation/i.test(err.message);
      return interaction.editReply({
        embeds: [
          embeds.error(
            interaction,
            invalid ? 'Invalid Payment Details' : 'QR Generation Failed',
            invalid
              ? `${String(err.message).replace(/^Validation error:\s*/i, '').slice(0, 500)}\n\nExample: \`/upiqr upi_id:name@bank amount:499 name:John Doe\``
              : 'Something went wrong while generating the QR code. Please try again.',
          ),
        ],
      });
    }

    // ---- Build one embed + one PNG attachment per QR ----
    const total = parts.length;
    const items = parts.map((part, i) => {
      const fileName = `upi-qr-${i + 1}.png`;
      const link = upiLink(upiId, part.amount, name);
      const embed = embeds.make(interaction, {
        color: embeds.COLORS.cyan,
        title: total > 1 ? `💸 UPI Payment — QR ${i + 1} of ${total}` : '💸 UPI Payment QR',
        description:
          total > 1 && i === 0
            ? `The total of **${rupees(amount)}** is above ${rupees(SPLIT_ABOVE)}, so it was split into **${total}** payments. Please scan **every** QR code.`
            : 'Scan this QR code with any UPI app (GPay, PhonePe, Paytm, BHIM…).',
        fields: [
          { name: '🏦 UPI ID', value: `\`${upiId}\``, inline: true },
          { name: '💰 Amount', value: `**${rupees(part.amount)}**`, inline: true },
          { name: '👤 Payee Name', value: name, inline: true },
          { name: '📲 Pay Now (UPI link)', value: `\`\`\`${link}\`\`\`` },
        ],
        image: `attachment://${fileName}`,
        thumbnail: false,
        footer: total > 1 ? `Part ${i + 1}/${total} • Total ${rupees(amount)}` : 'Open the link on a phone to pay',
      });
      return { embed, file: new AttachmentBuilder(dataUrlToBuffer(part.image), { name: fileName }) };
    });

    // ---- Send in chunks of 10 embeds (first chunk replaces the loading embed) ----
    for (let i = 0; i < items.length; i += EMBEDS_PER_MESSAGE) {
      const chunk = items.slice(i, i + EMBEDS_PER_MESSAGE);
      const payload = { embeds: chunk.map((c) => c.embed), files: chunk.map((c) => c.file) };
      if (i === 0) await interaction.editReply(payload);
      else await interaction.followUp(payload);
    }
  },
};
