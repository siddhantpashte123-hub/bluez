/**
 * /ltc qr <address> <amount> [currency]   Litecoin payment QR (amount in INR, USD or LTC)
 * /ltc price                              live LTC price
 * /ltc check [txid] [address]             open a form or look a transaction up
 *
 * Also exports buildLtcPayload() for the shop order tickets.
 */
const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { randomUUID } = require('node:crypto');
const embeds = require('../utils/embeds');
const ltc = require('../utils/ltc');
const cards = require('../utils/cards');
const branding = require('../utils/branding');
const { sendCard } = require('../utils/card-response');

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
        .addStringOption((o) => o.setName('txid').setDescription('Optional transaction ID, /tx/ path or explorer link (otherwise a form opens)').setMaxLength(300))
        .addStringOption((o) => o.setName('address').setDescription('Show how much this address received').setMaxLength(90)),
    )
    .addSubcommand((s) =>
      s.setName('cheak').setDescription('🔎 Alias for /ltc check.')
        .addStringOption((o) => o.setName('txid').setDescription('Optional transaction ID, /tx/ path or explorer link (otherwise a form opens)').setMaxLength(300))
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
      let rates;
      try {
        rates = await ltc.getRates();
      } catch (err) {
        console.error('[/ltc price]', err.message);
        return interaction.editReply({ embeds: [embeds.error(interaction, 'Price Not Available', 'The price services did not answer. Please try again in a moment.')] });
      }
      const inr = money(rates.inr, 'INR'), usd = money(rates.usd, 'USD');
      const embed = embeds.make(interaction, {
        color: embeds.COLORS.cyan, title: '📈 Litecoin Price',
        description: 'Price for 1 LTC. Rates may be cached for up to 60 seconds.',
        fields: [{ name: '🇮🇳 INR', value: `**${inr}**`, inline: true }, { name: '🇺🇸 USD', value: `**${usd}**`, inline: true }],
      });
      const png = cards.available() ? await cards.ltcPriceCard({ inr, usd, accent: branding.accent(interaction.guildId ?? interaction.guild.id) })
        .catch((err) => (console.error('[/ltc price] card:', err.message), null)) : null;
      return sendCard(interaction, embed, png, 'ltc-price.png');
    }

    // Slash with no transaction ID opens a form. Existing direct / and ! usage still works.
    let ctx = interaction, input = interaction.options.getString('txid'), address = interaction.options.getString('address')?.trim() ?? '';
    if (address && !ltc.isAddress(address)) return fail('Invalid Address', 'That does not look like a Litecoin address.');
    if (!input) {
      if (interaction.isPrefix) return fail('Use a Transaction ID or Slash Form', 'Use `!ltc check <txid>` or `/ltc check` to open the form.');
      const modalId = `ltc_check_${randomUUID()}`;
      const addressField = new TextInputBuilder().setCustomId('address').setLabel('Recipient LTC address (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(90)
        .setPlaceholder('Add your address to see what it received');
      if (address && ltc.isAddress(address)) addressField.setValue(address);
      const modal = new ModalBuilder().setCustomId(modalId).setTitle('Check Litecoin Transaction').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txid').setLabel('Transaction ID, /tx/ path or link').setPlaceholder('/tx/… or paste the full transaction ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300)),
        new ActionRowBuilder().addComponents(addressField),
      );
      await interaction.showModal(modal);
      try { ctx = await interaction.awaitModalSubmit({ time: 120_000, filter: s => s.customId === modalId && s.user.id === interaction.user.id }); }
      catch { return; }
      input = ctx.fields.getTextInputValue('txid');
      address = ctx.fields.getTextInputValue('address').trim();
    }
    const failCheck = (title, text) => ctx.reply(embeds.ephemeral(embeds.error(ctx, title, text)));
    const txid = ltc.extractTxid(input);
    if (!ltc.isTxid(txid)) return failCheck('Invalid Transaction ID', 'Paste a 64-character transaction ID, `/tx/` path, or explorer link.');
    if (address && !ltc.isAddress(address)) return failCheck('Invalid Address', 'That does not look like a Litecoin address.');
    await ctx.reply({ embeds: [embeds.loading(ctx, 'Looking the transaction up...')] });
    let tx;
    try { tx = await ltc.lookupTx(txid); }
    catch (err) {
      console.error('[/ltc check]', err.message);
      return ctx.editReply({ embeds: [embeds.error(ctx, 'Explorer Not Available', 'Could not get complete transaction data from the explorers. Try again later or check an explorer directly.')] });
    }
    if (!tx) return ctx.editReply({ embeds: [embeds.warn(ctx, 'Transaction Not Found', 'The explorers did not find this Litecoin transaction. If it was just sent, wait a minute and try again.')] });
    const total = ltc.formatSats(ltc.sumSats(tx.outputs));
    const amount = address ? ltc.formatSats(ltc.sumSats(tx.outputs, address)) : total;
    const count = tx.confirmations == null ? 'Unavailable' : String(tx.confirmations);
    const embed = embeds.make(ctx, {
      color: tx.confirmed ? embeds.COLORS.green : embeds.COLORS.gold,
      title: tx.confirmed ? `${embeds.e('tick')} Transaction Confirmed` : '⏳ Transaction Unconfirmed',
      description: address ? 'Amount sent to the supplied address. Check the address and required confirmations yourself.' : 'Total outputs may include change and payments to other recipients. Add a recipient address to check its amount.',
      fields: [
        { name: address ? '📥 Received by address' : '🪙 Total transaction outputs', value: `**${amount} LTC**`, inline: true },
        { name: '⛓️ Confirmations', value: `**${count}**`, inline: true },
        ...(address ? [{ name: '🏦 Recipient address', value: `\`${address}\`` }, { name: '🪙 Total outputs (may include change)', value: `${total} LTC`, inline: true }] : []),
        ...(tx.time ? [{ name: '🕒 Block / received time', value: `<t:${Math.floor(tx.time / 1000)}:R>`, inline: true }] : []),
        { name: '🔗 Transaction ID', value: `\`${txid}\`\n[Open LitecoinSpace](https://litecoinspace.org/tx/${txid})` },
      ],
      footer: `Source: ${tx.source} • Snapshot, not proof of order payment`,
    });
    const png = cards.available() ? await cards.ltcTransactionCard({ txid, amount, total, address, confirmations: tx.confirmations, confirmed: tx.confirmed, source: tx.source, accent: branding.accent(ctx.guildId ?? ctx.guild.id) })
      .catch(err => (console.error('[/ltc check] card:', err.message), null)) : null;
    return sendCard(ctx, embed, png, 'ltc-transaction.png');
  },
};
