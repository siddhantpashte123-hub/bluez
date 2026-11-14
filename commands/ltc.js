/**
 * /ltc qr <address> <amount> [currency]   Litecoin payment QR (amount in INR, USD or LTC)
 * /ltc price                              live LTC price
 * /ltc check <txid> [address]             look a transaction up on the blockchain
 *
 * Also exports buildLtcPayload() for the shop order tickets.
 */
const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');
const ltc = require('../utils/ltc');

const money = (n, currency) => n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 });

/**
 * Message payload ({ embeds, files }) with the QR for paying `amount` `currency` in LTC.
 * @returns {Promise<{ payload: object, ltcAmount: number }>}
 */
async function buildLtcPayload(ctx, address, amount, currency = 'INR') {
  const { ltc: ltcAmount, rates } = await ltc.toLtc(amount, currency);
  const png = await ltc.paymentQr(address, ltcAmount);
  const fields = [
    { name: '🪙 Amount', value: `**${ltc.formatLtc(ltcAmount)} LTC**`, inline: true },
    ...(currency !== 'LTC' ? [{ name: '💰 Price', value: money(amount, currency), inline: true }] : []),
    ...(rates ? [{ name: '📈 Rate', value: `1 LTC = ${money(rates.inr, 'INR')} / ${money(rates.usd, 'USD')}`, inline: true }] : []),
    { name: '🏦 Litecoin address', value: `\`\`\`${address}\`\`\`` },
  ];
  return {
    ltcAmount,
    payload: {
      embeds: [
        embeds.make(ctx, {
          color: embeds.COLORS.cyan,
          title: '🪙 Litecoin (LTC) Payment',
          description: 'Scan the QR code with your wallet, or copy the address and send the **exact** amount.\nSend **only LTC on the Litecoin network** to this address.',
          fields,
          image: 'attachment://ltc-qr.png',
          thumbnail: false,
          footer: 'The rate is live and changes every minute',
        }),
      ],
      files: [new AttachmentBuilder(png, { name: 'ltc-qr.png' })],
    },
  };
}

module.exports = {
  buildLtcPayload,
  money,

  data: new SlashCommandBuilder()
    .setName('ltc')
    .setDescription('🪙 Litecoin payments.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('qr').setDescription('🪙 Generate a Litecoin payment QR code.')
        .addStringOption((o) => o.setName('address').setDescription('Your LTC address').setRequired(true).setMaxLength(90))
        .addNumberOption((o) => o.setName('amount').setDescription('Amount to receive').setRequired(true).setMinValue(0.0001).setMaxValue(10_000_000))
        .addStringOption((o) => o.setName('currency').setDescription('Currency of the amount (default INR)').addChoices({ name: 'INR (₹)', value: 'INR' }, { name: 'USD ($)', value: 'USD' }, { name: 'LTC', value: 'LTC' })),
    )
    .addSubcommand((s) => s.setName('price').setDescription('📈 Live Litecoin price.'))
    .addSubcommand((s) =>
      s.setName('check').setDescription('🔎 Look a Litecoin transaction up.')
        .addStringOption((o) => o.setName('txid').setDescription('Transaction ID (hash) or the explorer link of the transaction').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('address').setDescription('Show how much this address received').setMaxLength(90)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    if (sub === 'qr') {
      const address = interaction.options.getString('address', true).trim();
      if (!ltc.isAddress(address)) return fail('Invalid Address', 'That does not look like a Litecoin address (it starts with `L`, `M` or `ltc1`).');
      await interaction.reply({ embeds: [embeds.loading(interaction, 'Generating Litecoin QR code...')] });
      try {
        const { payload } = await buildLtcPayload(interaction, address, interaction.options.getNumber('amount', true), interaction.options.getString('currency') ?? 'INR');
        return interaction.editReply(payload);
      } catch (err) {
        console.error('[/ltc qr]', err.message);
        return interaction.editReply({ embeds: [embeds.error(interaction, 'QR Generation Failed', 'I could not load the live LTC price. Please try again in a moment, or use `currency: LTC`.')] });
      }
    }

    if (sub === 'price') {
      await interaction.reply({ embeds: [embeds.loading(interaction, 'Loading the LTC price...')] });
      try {
        const rates = await ltc.getRates();
        return interaction.editReply({
          embeds: [embeds.make(interaction, { color: embeds.COLORS.cyan, title: '📈 Litecoin Price', fields: [{ name: '🇮🇳 INR', value: `**${money(rates.inr, 'INR')}**`, inline: true }, { name: '🇺🇸 USD', value: `**${money(rates.usd, 'USD')}**`, inline: true }] })],
        });
      } catch (err) {
        console.error('[/ltc price]', err.message);
        return interaction.editReply({ embeds: [embeds.error(interaction, 'Price Not Available', 'The price services did not answer. Please try again in a moment.')] });
      }
    }

    // check
    const txid = ltc.extractTxid(interaction.options.getString('txid', true));
    const address = interaction.options.getString('address')?.trim();
    if (!ltc.isTxid(txid)) return fail('Invalid Transaction ID', 'A transaction ID (hash) has 64 characters (0-9, a-f). You can also paste the link of the transaction page.');
    if (address && !ltc.isAddress(address)) return fail('Invalid Address', 'That does not look like a Litecoin address.');
    await interaction.reply({ embeds: [embeds.loading(interaction, 'Looking the transaction up...')] });
    let tx;
    try {
      tx = await ltc.lookupTx(txid);
    } catch (err) {
      console.error('[/ltc check]', err.message);
      return interaction.editReply({ embeds: [embeds.error(interaction, 'Explorer Not Reachable', 'The block explorers did not answer. Please try again in a moment.')] });
    }
    if (!tx) return interaction.editReply({ embeds: [embeds.warn(interaction, 'Transaction Not Found', 'No Litecoin transaction with this ID was found. If it was just sent, wait a minute and try again.')] });
    const total = tx.outputs.reduce((sum, o) => sum + o.sats, 0) / 1e8;
    return interaction.editReply({
      embeds: [
        embeds.make(interaction, {
          color: tx.confirmed ? embeds.COLORS.green : embeds.COLORS.gold,
          title: tx.confirmed ? `${embeds.e('tick')} Transaction Confirmed` : '⏳ Transaction Unconfirmed',
          fields: [
            { name: '🪙 Total sent', value: `${ltc.formatLtc(total)} LTC`, inline: true },
            ...(address ? [{ name: '📥 Received by the address', value: `**${ltc.formatLtc(ltc.paidTo(tx, address))} LTC**`, inline: true }] : []),
            ...(tx.time ? [{ name: '🕒 Time', value: `<t:${Math.floor(tx.time / 1000)}:R>`, inline: true }] : []),
            { name: '🔗 Explorer', value: `[Open transaction](https://litecoinspace.org/tx/${txid.toLowerCase()})` },
          ],
        }),
      ],
    });
  },
};
