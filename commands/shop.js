/**
 * Shop / order system
 * ---------------------------------------------------------------
 * /shop setup <upi_id> <name>              payee details for the UPI QR (admins)
 * /shop add <name> <price> [stock] [description]
 * /shop remove <product>
 * /shop stock <product> <amount>           -1 = unlimited
 * /shop products                           price + stock list (everyone)
 * /shop panel [channel]                    post the shop with "Buy" buttons
 *
 * Buying: the member presses a product button -> a private order
 * ticket is created -> the UPI QR for the price is posted there ->
 * staff checks the payment and presses "Mark as Paid" (stock -1).
 *
 * NOTE: a UPI payment cannot be verified by a bot. Staff must check
 * their own UPI app before pressing "Mark as Paid".
 *
 * Button IDs: "shop_buy_<productId>", "shop_paid_<productId>"
 * Storage (data/shop.json):
 *   { "<guildId>": { upiId, payeeName, counter, sold, products: { "<id>": { name, price, stock, description } } } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const tickets = require('./ticket');
const logs = require('./logs');
const { buildQrPayloads, rupees } = require('./upiqr');
const { buildLtcPayload } = require('./ltc');
const ltc = require('../utils/ltc');
const cards = require('../utils/cards');
const branding = require('../utils/branding');
const audit = require('../utils/audit');
const { sendCard } = require('../utils/card-response');

/** An LTC payment may be up to 1% short (wallet fees / rounding) and still count. */
const LTC_TOLERANCE = 0.99;
/** A payment must be newer than the quote (minus this slack) – stops old transactions being reused. */
const LTC_TIME_SLACK_MS = 10 * 60 * 1000;

const MAX_PRODUCTS = 20; // 4 rows of 5 buttons
const MAX_PRICE = 50_000;

const shopOf = (guildId) => db.guild('shop', guildId);
const productsOf = (guildId) => Object.entries(shopOf(guildId).products ?? {});
const stockText = (stock) => (stock < 0 ? '♾️ Unlimited' : stock === 0 ? '❌ Out of stock' : `📦 ${stock} left`);

/** Find a product by ID or (case-insensitive) name. */
function findProduct(guildId, text) {
  const wanted = text.trim().toLowerCase();
  return productsOf(guildId).find(([id, p]) => id === wanted || p.name.toLowerCase() === wanted) ?? null;
}

function productsEmbed(ctx, guild, category = null) {
  const list = productsOf(guild.id).filter(([, p]) => !category || (p.category ?? 'Uncategorized').toLowerCase() === category.toLowerCase());
  return embeds.make(ctx, {
    color: embeds.COLORS.cyan,
    title: `${embeds.e('nitro')} ${guild.name} — Shop`,
    description: list.length
      ? list.map(([, p]) => `### ${p.name} — ${rupees(p.price)}\n**Category:** ${p.category ?? 'Uncategorized'}\n${p.description ? `${p.description}\n` : ''}${stockText(p.stock)}`).join('\n')
      : '*No products yet.*',
    thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
    footer: `Press a button to order • Payment by ${[shopOf(guild.id).upiId && 'UPI', shopOf(guild.id).ltcAddress && 'Litecoin'].filter(Boolean).join(' or ') || 'UPI'}`,
  });
}

function buyRows(guildId, category = null) {
  const buttons = productsOf(guildId).filter(([, p]) => !category || (p.category ?? 'Uncategorized').toLowerCase() === category.toLowerCase()).map(([id, p]) =>
    new ButtonBuilder().setCustomId(`shop_buy_${id}`).setLabel(`${p.name}`.slice(0, 60)).setEmoji('🛒').setStyle(ButtonStyle.Success).setDisabled(p.stock === 0),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return rows;
}

/* ---------------- Button: buy ---------------- */
async function handleBuy(interaction, productId, couponCode = null) {
  const { guild, user } = interaction;
  const shop = shopOf(guild.id);
  const product = shop.products?.[productId];
  if (!product) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Product Not Found', 'This product is no longer sold.')));
  if (product.stock === 0) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Out of Stock', `**${product.name}** is sold out right now.`)));
  if (!shop.upiId && !shop.ltcAddress) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Shop Is Not Set Up', 'An admin has to run `/shop setup` or `/shop ltc` first.')));
  const code = couponCode?.trim().toUpperCase() || null;
  const coupon = code ? shop.coupons?.[code] : null;
  if (code && (!coupon || coupon.expiresAt <= Date.now())) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Coupon', 'This coupon does not exist or has expired. Press Buy again to retry.')));
  const price = coupon ? Math.max(1, Math.round(product.price * (100 - coupon.percent)) / 100) : product.price;

  const channel = await tickets.openTicket(interaction, {
    prize: product.name,
    hostId: null,
    prefix: 'order',
    topic: `Order: ${product.name} (${rupees(price)})`,
    title: '🛒 New Order',
    description:
      `Thanks for your order, ${user}! ${embeds.e('bow')}\n` +
      `**Product:** ${product.name}\n**Price:** ${rupees(price)}${coupon ? ` (${coupon.percent}% coupon: ${code})` : ''}\n\n` +
      (shop.upiId ? 'Pay with the UPI QR code below, then send a **screenshot of the payment** here. Staff will confirm it and deliver your product.' : 'Press **Pay with LTC** below to get the Litecoin payment details.') +
      (shop.upiId && shop.ltcAddress ? '\nYou can also pay with **Litecoin (LTC)** using the button below.' : ''),
    ownerLabel: '🛒 Buyer',
    hostLabel: '🛟 Handled by',
  });
  if (!channel) return undefined;

  const ticket = tickets.configOf(guild.id)?.tickets?.[channel.id];
  if (ticket) {
    db.updateGuild('orders', guild.id, (store) => {
      (store.items ??= {})[channel.id] = { userId: user.id, number: ticket.number, productId, product: product.name, price, originalPrice: product.price, coupon: code, status: 'pending', createdAt: Date.now() };
    });
    let png = null;
    if (cards.available()) png = await cards.orderCard({ number: ticket.number, product: product.name, price: rupees(price), status: 'PENDING', buyer: user.username, accent: branding.accent(guild.id) }).catch((err) => (console.error('[Shop] receipt:', err.message), null));
    const receipt = embeds.info(interaction, '🧾 Order Receipt', `Order **#${ticket.number}** • **${product.name}** • ${rupees(price)}\nStatus: **Pending payment**\nUse \`/shop orders\` to see your orders.`);
    if (png) receipt.setImage('attachment://receipt.png');
    const payload = { embeds: [receipt], ...(png ? { files: [new AttachmentBuilder(png, { name: 'receipt.png' })] } : {}), allowedMentions: { parse: [] } };
    await channel.send(payload).catch(() => channel.send({ embeds: [embeds.info(interaction, '🧾 Order Receipt', `Order **#${ticket.number}** • **${product.name}** • ${rupees(price)}\nStatus: **Pending payment**`)] }).catch(() => {}));
  }

  if (shop.upiId) {
    try {
      for (const payload of await buildQrPayloads(interaction, shop.upiId, price, shop.payeeName)) await channel.send(payload);
    } catch (err) {
      console.error('[Shop] QR failed:', err.message);
      await channel.send({ embeds: [embeds.error(interaction, 'QR Generation Failed', `Please pay **${rupees(price)}** to \`${shop.upiId}\` manually.`)] }).catch(() => {});
    }
  }
  if (shop.ltcAddress) {
    await channel
      .send({
        embeds: [embeds.info(interaction, '🪙 Pay with Litecoin', `Press the button to get the LTC address, QR code and the exact amount for **${rupees(price)}** at the live rate.\nLTC payments are checked on the blockchain automatically.`)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shop_ltc_${productId}`).setLabel('Pay with LTC').setEmoji('🪙').setStyle(ButtonStyle.Primary))],
      })
      .catch(() => {});
  }
  await channel
    .send({
      embeds: [embeds.info(interaction, '🧾 Staff Only', 'Check the payment in your own UPI app / wallet first, then press the button. Bots cannot verify UPI payments.')],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shop_paid_${productId}`).setLabel('Mark as Paid').setEmoji('💰').setStyle(ButtonStyle.Success))],
    })
    .catch(() => {});
  return undefined;
}

/* ---------------- Litecoin ---------------- */

/** The open order ticket of this channel (or null). */
const orderOf = (interaction) => tickets.configOf(interaction.guild.id)?.tickets?.[interaction.channel.id] ?? null;

/** Button "Pay with LTC": post address + QR + exact amount (live rate) and remember the quote. */
async function handleLtcQuote(interaction, productId) {
  const { guild, channel } = interaction;
  const shop = shopOf(guild.id);
  const product = shop.products?.[productId];
  const trackedOrder = db.guild('orders', guild.id).items?.[channel.id];
  if (!orderOf(interaction)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Not an Order', 'This channel is not an open order ticket.')));
  if (orderOf(interaction).paid) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Already Paid', 'This order is already paid.')));
  if ((!product && !trackedOrder) || !shop.ltcAddress || (trackedOrder && trackedOrder.productId !== productId)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'LTC Not Available', 'This product or the Litecoin address is no longer set up.')));

  const address = shop.ltcAddress;
  await interaction.deferReply();
  let quote;
  try {
    quote = await buildLtcPayload(interaction, address, trackedOrder?.price ?? product.price, 'INR');
  } catch (err) {
    console.error('[Shop] LTC quote failed:', err.message);
    return interaction.editReply({ embeds: [embeds.error(interaction, 'LTC Price Not Available', 'I could not load the live LTC price. Please try again in a moment.')] });
  }
  if (!orderOf(interaction) || orderOf(interaction).paid) return interaction.editReply({ embeds: [embeds.warn(interaction, 'Order Changed', 'The order is closed or already paid.')] });
  db.update('tickets', (data) => {
    data[guild.id].tickets[channel.id].ltc = { amount: quote.ltcAmount, address, productId, at: Date.now() };
  });
  return interaction.editReply({
    ...quote.payload,
    components: [
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shop_ltcverify_${productId}`).setLabel('I Have Paid — Verify').setEmoji('🔎').setStyle(ButtonStyle.Success)),
    ],
  });
}

/** Button "I Have Paid": ask for the transaction ID. */
async function handleLtcVerifyButton(interaction, productId) {
  const order = orderOf(interaction);
  if (!order?.ltc) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'No LTC Payment Requested', 'Press **Pay with LTC** first.')));
  if (order.paid) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Already Paid', 'This order is already paid.')));
  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(`shop_ltctx_${productId}`)
      .setTitle('Verify Litecoin Payment')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('txid').setLabel('Transaction ID (hash) or explorer link').setPlaceholder('Paste the transaction hash, or the "View Transaction" link').setStyle(TextInputStyle.Short).setMinLength(64).setMaxLength(300).setRequired(true),
        ),
      ),
  );
}

/** Modal: check the transaction on the blockchain and complete the order when it fits. */
async function handleModal(interaction) {
  if (interaction.customId.startsWith('shop_couponbuy_')) {
    const productId = interaction.customId.slice('shop_couponbuy_'.length);
    return handleBuy(interaction, productId, interaction.fields.getTextInputValue('coupon'));
  }
  const { guild, channel } = interaction;
  const order = orderOf(interaction);
  const quote = order?.ltc;
  const reply = (embed) => interaction.editReply({ embeds: [embed] });
  if (!quote) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'No LTC Payment Requested', 'Press **Pay with LTC** first.')));
  if (order.paid) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Already Paid', 'This order is already paid.')));

  const txid = ltc.extractTxid(interaction.fields.getTextInputValue('txid'));
  if (!ltc.isTxid(txid)) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Invalid Transaction ID', 'A transaction ID (hash) has 64 characters (0-9, a-f). Copy it from your wallet, or paste the link of the transaction page.')));
  if ((shopOf(guild.id).usedTx ?? []).includes(txid)) {
    return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Transaction Already Used', 'This transaction was already used for another order.')));
  }

  await interaction.deferReply();
  let tx;
  try {
    tx = await ltc.lookupTx(txid);
  } catch (err) {
    console.error('[Shop] LTC lookup failed:', err.message);
    return reply(embeds.error(interaction, 'Could Not Check the Payment', 'The block explorers did not answer. Please try again in a minute, or ask staff to check it.'));
  }
  if (!tx) return reply(embeds.warn(interaction, 'Transaction Not Found', 'I could not find this transaction on the Litecoin network. If you just sent it, wait a minute and press **Verify** again.'));

  const received = ltc.paidTo(tx, quote.address);
  const needed = `**${ltc.formatLtc(quote.amount)} LTC**`;
  if (received <= 0) return reply(embeds.error(interaction, 'Wrong Transaction', `This transaction does not pay to the shop address.\nSend ${needed} to \`${quote.address}\`.`));
  if (received < quote.amount * LTC_TOLERANCE) {
    return reply(embeds.error(interaction, 'Amount Too Low', `The transaction pays **${ltc.formatLtc(received)} LTC**, but ${needed} is needed. Please ask staff for help.`));
  }
  if (tx.time && tx.time < quote.at - LTC_TIME_SLACK_MS) {
    return reply(embeds.error(interaction, 'Old Transaction', 'This transaction was made before this order. Please send a new payment, or ask staff for help.'));
  }
  if (!tx.confirmed) {
    return reply(embeds.warn(interaction, 'Payment Seen — Waiting for Confirmation', `I can see **${ltc.formatLtc(received)} LTC** on the way. ⏳\nIt needs **1 confirmation** (usually 2-5 minutes). Press **Verify** again after that.`));
  }

  // Recheck after the network lookup: another verifier may have finished meanwhile.
  if (!orderOf(interaction) || orderOf(interaction).paid || orderOf(interaction).ltc !== quote || (shopOf(guild.id).usedTx ?? []).includes(txid)) return reply(embeds.warn(interaction, 'Already Processed', 'This order or transaction was already processed.'));
  // Confirmed, right address, right amount, never used before -> the order is paid.
  const product = markPaid(guild.id, channel.id, quote.productId, txid);
  const name = product?.name ?? order.prize ?? 'the product';
  await reply(
    embeds.success(interaction, 'Payment Verified', `**${ltc.formatLtc(received)} LTC** received and confirmed on the blockchain for **${name}**.\n<@${order.userId}>, your product will be delivered here. Leave a review with \`/vouch\` afterwards! ${embeds.e('bow')}`, {
      fields: [{ name: '🔗 Transaction', value: `[${txid.slice(0, 16)}…](https://litecoinspace.org/tx/${txid})` }],
    }),
  );
  await logs.sendLog(guild, {
    embeds: [
      embeds.make(interaction, {
        color: embeds.COLORS.green,
        title: '🪙 Order Paid (LTC, verified)',
        fields: [
          { name: '🛒 Product', value: name, inline: true },
          { name: '👤 Buyer', value: `<@${order.userId}>`, inline: true },
          { name: '🪙 Received', value: `${ltc.formatLtc(received)} LTC`, inline: true },
          { name: '🔗 Transaction', value: `[${txid}](https://litecoinspace.org/tx/${txid})` },
        ],
      }),
    ],
  });
  return undefined;
}

/** Stock -1, sold +1, order flagged as paid. Returns the product (or null when it was removed). */
function markPaid(guildId, channelId, productId, txid = null) {
  let product = null;
  db.updateGuild('shop', guildId, (shop) => {
    product = shop.products?.[productId] ?? null;
    if (product && product.stock > 0) product.stock -= 1;
    shop.sold = (shop.sold ?? 0) + 1;
    if (txid) shop.usedTx = [...(shop.usedTx ?? []), txid].slice(-5000);
  });
  db.update('tickets', (data) => {
    const order = data[guildId]?.tickets?.[channelId];
    if (order) order.paid = true;
  });
  db.updateGuild('orders', guildId, (store) => {
    const order = store.items?.[channelId];
    if (order) { order.status = 'paid'; order.paidAt = Date.now(); }
  });
  return product;
}

/* ---------------- Button: mark as paid (staff) ---------------- */
async function handlePaid(interaction, productId) {
  const { guild, channel } = interaction;
  const config = tickets.configOf(guild.id);
  const order = config?.tickets?.[channel.id];
  if (!order) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Not an Order', 'This channel is not an open order ticket.')));
  if (!tickets.isStaff(interaction.member, config) || interaction.user.id === order.userId) {
    return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Staff Only', 'Only the support team can confirm a payment.')));
  }

  if (order.paid) return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Already Paid', 'This order is already marked as paid.')));

  const product = markPaid(guild.id, channel.id, productId);
  const name = product?.name ?? order.prize ?? 'the product';
  const paidPrice = db.guild('orders', guild.id).items?.[channel.id]?.price ?? product?.price;

  await interaction.update({
    embeds: [embeds.success(interaction, 'Payment Confirmed', `${interaction.user} confirmed the payment for **${name}**.\n<@${order.userId}>, your product will be delivered here. Leave a review with \`/vouch\` afterwards! ${embeds.e('bow')}`)],
    components: [],
  });
  await logs.sendLog(guild, {
    embeds: [
      embeds.make(interaction, {
        color: embeds.COLORS.green,
        title: '💰 Order Paid',
        fields: [
          { name: '🛒 Product', value: name, inline: true },
          { name: '👤 Buyer', value: `<@${order.userId}>`, inline: true },
          { name: '🧾 Confirmed by', value: `${interaction.user}`, inline: true },
          ...(product ? [{ name: '💵 Price', value: rupees(paidPrice), inline: true }, { name: '📦 Stock', value: stockText(product.stock), inline: true }] : []),
        ],
      }),
    ],
  });
  return undefined;
}

async function handleButton(interaction) {
  const [, action, ...rest] = interaction.customId.split('_');
  const productId = rest.join('_');
  if (action === 'buy') return interaction.showModal(new ModalBuilder().setCustomId(`shop_couponbuy_${productId}`).setTitle('Complete Your Order').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('coupon').setLabel('Coupon code (optional)').setPlaceholder('Leave blank if you have no coupon').setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(false)),
  ));
  if (action === 'paid') return handlePaid(interaction, productId);
  if (action === 'ltc') return handleLtcQuote(interaction, productId);
  if (action === 'ltcverify') return handleLtcVerifyButton(interaction, productId);
  return undefined;
}

const productOpt = (o) => o.setName('product').setDescription('Product name').setRequired(true).setMaxLength(60);

module.exports = {
  handleButton,
  handleModal,

  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛒 Shop and orders.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('setup').setDescription('⚙️ Set the UPI details used for orders (admins).')
        .addStringOption((o) => o.setName('upi_id').setDescription('UPI ID, e.g. name@bank').setRequired(true).setMinLength(3).setMaxLength(50))
        .addStringOption((o) => o.setName('name').setDescription('Payee name').setRequired(true).setMaxLength(60)),
    )
    .addSubcommand((s) =>
      s.setName('ltc').setDescription('🪙 Accept Litecoin for orders (admins). Leave the address empty to turn it off.')
        .addStringOption((o) => o.setName('address').setDescription('Your LTC address').setMaxLength(90)),
    )
    .addSubcommand((s) =>
      s.setName('add').setDescription('➕ Add a product (admins).')
        .addStringOption((o) => o.setName('name').setDescription('Product name').setRequired(true).setMaxLength(60))
        .addNumberOption((o) => o.setName('price').setDescription('Price in ₹').setRequired(true).setMinValue(1).setMaxValue(MAX_PRICE))
        .addIntegerOption((o) => o.setName('stock').setDescription('How many are available (default: unlimited)').setMinValue(0).setMaxValue(100000))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setMaxLength(150)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('➖ Remove a product (admins).').addStringOption(productOpt))
    .addSubcommand((s) =>
      s.setName('stock').setDescription('📦 Change the stock of a product (admins).')
        .addStringOption(productOpt)
        .addIntegerOption((o) => o.setName('amount').setDescription('New stock (-1 = unlimited)').setRequired(true).setMinValue(-1).setMaxValue(100000)),
    )
    .addSubcommand((s) => s.setName('products').setDescription('🛍️ Show all products with price and stock.'))
    .addSubcommand((s) => s.setName('product').setDescription('Show a product detail card.').addStringOption(productOpt))
    .addSubcommand((s) => s.setName('search').setDescription('Privately search tracked orders (staff).')
      .addIntegerOption((o) => o.setName('number').setDescription('Order number').setMinValue(1))
      .addUserOption((o) => o.setName('customer').setDescription('Customer'))
      .addStringOption((o) => o.setName('status').setDescription('Order status').addChoices(...['pending', 'paid', 'delivered', 'cancelled'].map(value => ({ name: value, value })))) )
    .addSubcommand((s) => s.setName('category').setDescription('Assign a product category (admin).').addStringOption(productOpt)
      .addStringOption((o) => o.setName('name').setDescription('Category name; use Uncategorized to clear').setRequired(true).setMinLength(1).setMaxLength(30)))
    .addSubcommand((s) => s.setName('dashboard').setDescription('Private sales dashboard (admin).'))
    .addSubcommand((s) => s.setName('couponstats').setDescription('Private coupon statistics (admin).'))
    .addSubcommand((s) => s.setName('notes').setDescription('View private order notes (staff).').addIntegerOption((o) => o.setName('number').setDescription('Order number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('coupon').setDescription('🎟️ Create or replace a percentage coupon (admins).')
      .addStringOption((o) => o.setName('code').setDescription('Letters, numbers, dash or underscore').setRequired(true).setMinLength(2).setMaxLength(32))
      .addIntegerOption((o) => o.setName('percent').setDescription('Discount percentage').setRequired(true).setMinValue(1).setMaxValue(90))
      .addIntegerOption((o) => o.setName('days').setDescription('Expires after this many days').setRequired(true).setMinValue(1).setMaxValue(365)))
    .addSubcommand((s) => s.setName('uncoupon').setDescription('🎟️ Remove a coupon (admins).')
      .addStringOption((o) => o.setName('code').setDescription('Coupon code').setRequired(true).setMinLength(2).setMaxLength(32)))
    .addSubcommand((s) => s.setName('orders').setDescription('🧾 View your recent shop orders privately.'))
    .addSubcommand((s) => s.setName('delivered').setDescription('📦 Mark the paid order in this ticket as delivered (staff).'))
    .addSubcommand((s) =>
      s.setName('panel').setDescription('📌 Post the shop with Buy buttons (admins).')
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: this channel)').addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('category').setDescription('Optional product category filter').setMaxLength(30)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    if (sub === 'products') return interaction.reply({ embeds: [productsEmbed(interaction, guild)] });
    if (sub === 'product') {
      const found = findProduct(guild.id, interaction.options.getString('product', true));
      if (!found) return fail('Product Not Found', 'Check `/shop products`.');
      const [, product] = found;
      const embed = embeds.make(interaction, { title: `🛍️ ${product.name}`, color: embeds.COLORS.cyan, description: product.description || 'No description.', fields: [{ name: 'Price', value: rupees(product.price), inline: true }, { name: 'Stock', value: stockText(product.stock), inline: true }, { name: 'Category', value: product.category || 'Uncategorized', inline: true }], thumbnail: false });
      let png = null;
      if (cards.available()) {
        await interaction.deferReply();
        png = await cards.featureCard({ eyebrow: 'Product details', title: product.name, detail: product.description || 'Available in our shop', badge: 'SHOP', footer: `${rupees(product.price)} • ${product.stock < 0 ? 'Unlimited stock' : `${product.stock} in stock`}`, accent: branding.accent(guild.id) }).catch(() => null);
      }
      return sendCard(interaction, embed, png, 'product.png');
    }
    if (sub === 'search') {
      if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'For privacy, use `/shop search`.')] });
      if (!tickets.isStaff(interaction.member, tickets.configOf(guild.id))) return fail('Staff Only', 'Only the support team can search orders.');
      const number = interaction.options.getInteger('number'), customer = interaction.options.getUser('customer'), status = interaction.options.getString('status');
      if (!number && !customer && !status) return fail('Filter Required', 'Provide a number, customer or status.');
      const items = Object.entries(db.guild('orders', guild.id).items ?? {}).filter(([channelId, o]) => o.userId !== interaction.user.id && tickets.isStaff(interaction.member, tickets.configOf(guild.id), db.guild('tickets', guild.id).tickets?.[channelId]) && (!number || o.number === number) && (!customer || o.userId === customer.id) && (!status || o.status === status)).sort((a,b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
      const text = items.slice(0, 10).map(([channelId, o]) => `**#${o.number}** • ${String(o.product).slice(0, 60)} • ${rupees(o.price)}\n${o.status} • <@${o.userId}> • <#${channelId}>`).join('\n\n') || 'No matching orders.';
      return interaction.reply({ ...embeds.ephemeral(embeds.make(interaction, { title: '🔍 Order Search', description: `${text}\n\nShowing ${Math.min(items.length, 10)} of ${items.length} matches. Your own orders are excluded.` })), allowedMentions: { parse: [] } });
    }

    if (sub === 'orders') {
      if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use the Slash Command', 'For privacy, use `/shop orders`.')] });
      const items = Object.entries(db.guild('orders', guild.id).items ?? {}).filter(([, order]) => order.userId === interaction.user.id).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 10);
      const text = items.map(([id, order]) => `**#${order.number}** • ${order.product} • ${rupees(order.price)}\nStatus: **${order.status}** • <t:${Math.floor(order.createdAt / 1000)}:R> • <#${id}>`).join('\n\n') || 'No orders yet.';
      return interaction.reply({ ...embeds.ephemeral(embeds.make(interaction, { title: '🧾 Your Orders', color: embeds.COLORS.cyan, description: text })), allowedMentions: { parse: [] } });
    }
    if (sub === 'delivered') {
      const config = tickets.configOf(guild.id);
      const order = db.guild('orders', guild.id).items?.[interaction.channelId];
      if (!order) return fail('Not an Order', 'Use this inside a tracked order ticket.');
      if (!tickets.isStaff(interaction.member, config) || order.userId === interaction.user.id) return fail('Staff Only', 'Only the support team can mark this order delivered.');
      if (order.status !== 'paid') return fail('Cannot Mark Delivered', order.status === 'delivered' ? 'This order is already marked delivered.' : 'The order must be marked paid first.');
      db.updateGuild('orders', guild.id, (store) => { store.items[interaction.channelId].status = 'delivered'; store.items[interaction.channelId].deliveredAt = Date.now(); });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Order Delivered', `Order **#${order.number}** marked delivered. The buyer can review using \`/vouch give\`.`)], allowedMentions: { parse: [] } });
    }

    if (sub === 'notes') {
      if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'Order notes are private. Use `/shop notes`.')] });
      if (!tickets.isStaff(interaction.member, tickets.configOf(guild.id))) return fail('Staff Only', 'Only the support team can view notes.');
      const number = interaction.options.getInteger('number', true);
      const item = Object.entries(db.guild('orders', guild.id).items ?? {}).find(([, order]) => order.number === number);
      if (!item) return fail('Order Not Found', 'Only tracked orders can be viewed.');
      if (item[1].userId === interaction.user.id) return fail('Not Allowed', 'Buyers cannot view internal notes on their own orders.');
      const notes = db.guild('ordernotes', guild.id).items?.[item[0]] ?? [];
      const text = notes.slice(-10).reverse().map((n) => `<t:${Math.floor(n.at / 1000)}:R> • <@${n.by}>\n${n.text}`).join('\n\n') || 'No notes.';
      return interaction.reply({ ...embeds.ephemeral(embeds.make(interaction, { title: `Private Notes — Order #${number}`, description: text })), allowedMentions: { parse: [] } });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return fail('Missing Permission', 'You need the **Manage Server** permission for this.');

    if (sub === 'dashboard' || sub === 'couponstats') {
      if (interaction.isPrefix) return interaction.reply({ embeds: [embeds.warn(interaction, 'Use Slash Command', 'Sales statistics are private. Use the slash command.')] });
      const orders = Object.values(db.guild('orders', guild.id).items ?? {}).filter((o) => o.status === 'paid' || o.status === 'delivered');
      if (sub === 'dashboard') {
        const total = orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0);
        const counts = new Map(); for (const o of orders) counts.set(o.product, (counts.get(o.product) ?? 0) + 1);
        const top = [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${name} — ${count}`).join('\n') || 'No paid orders.';
        return interaction.reply(embeds.ephemeral(embeds.make(interaction, { title: '📊 Sales Dashboard', description: 'Tracked orders only. Revenue is recorded order value, not a bank reconciliation.', fields: [ { name: 'Paid orders', value: `${orders.length}`, inline: true }, { name: 'Recorded revenue', value: rupees(total), inline: true }, { name: 'Top products', value: top.slice(0, 1024) } ] })));
      }
      const groups = {};
      for (const o of orders.filter((o) => o.coupon)) { const g = (groups[o.coupon] ??= { count: 0, discount: 0, unknown: 0 }); g.count++; if (Number.isFinite(o.originalPrice) && Number.isFinite(o.price)) g.discount += Math.max(0, o.originalPrice - o.price); else g.unknown++; }
      const rows = Object.entries(groups).sort((a,b) => b[1].count - a[1].count).slice(0, 15).map(([code, g]) => `\`${code}\` — ${g.count} paid • ${rupees(g.discount)} known discount${g.unknown ? ` (${g.unknown} older unknown)` : ''}`);
      return interaction.reply(embeds.ephemeral(embeds.make(interaction, { title: '🎟️ Coupon Statistics', description: rows.join('\n') || 'No paid coupon orders recorded.', footer: 'Counts tracked paid orders, not pending uses' })));
    }
    if (sub === 'category') {
      const found = findProduct(guild.id, interaction.options.getString('product', true));
      if (!found) return fail('Product Not Found', 'Check `/shop products`.');
      const name = interaction.options.getString('name', true).trim();
      if (!name || /[\n\r]/.test(name)) return fail('Invalid Category', 'Enter a non-empty single-line category.');
      db.updateGuild('shop', guild.id, (store) => { store.products[found[0]].category = name; });
      audit.record(guild.id, interaction.user.id, 'shop.category', found[0]);
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Category Saved', `Product category updated to **${name}**. Repost the panel to update it.`)));
    }

    if (sub === 'coupon' || sub === 'uncoupon') {
      const code = interaction.options.getString('code', true).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) return fail('Invalid Code', 'Use 2–32 letters, numbers, underscores or dashes.');
      if (sub === 'uncoupon') {
        if (!shopOf(guild.id).coupons?.[code]) return fail('Coupon Not Found', 'No coupon with that code exists.');
        db.updateGuild('shop', guild.id, (shop) => { delete shop.coupons[code]; });
        audit.record(guild.id, interaction.user.id, 'shop.coupon.remove');
        return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Coupon Removed', `Coupon \`${code}\` is no longer valid.`)));
      }
      const percent = interaction.options.getInteger('percent', true), days = interaction.options.getInteger('days', true);
      const expiresAt = Date.now() + days * 86400000;
      db.updateGuild('shop', guild.id, (shop) => { (shop.coupons ??= {})[code] = { percent, expiresAt }; });
      audit.record(guild.id, interaction.user.id, 'shop.coupon.set');
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Coupon Saved', `\`${code}\`: **${percent}% off**, expires <t:${Math.floor(expiresAt / 1000)}:R>. Reusable until removed or expired; minimum order ₹1.`)));
    }

    if (sub === 'setup') {
      const upiId = interaction.options.getString('upi_id', true).trim();
      if (!/^[\w.-]{2,}@[a-zA-Z][\w.-]{1,}$/.test(upiId)) return fail('Invalid UPI ID', 'A UPI ID looks like `name@bank`.');
      db.updateGuild('shop', guild.id, (shop) => {
        shop.upiId = upiId;
        shop.payeeName = interaction.options.getString('name', true).trim();
        shop.products ??= {};
      });
      audit.record(guild.id, interaction.user.id, 'shop.payment.setup');
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Shop Payment Details Saved', `Orders will show a QR for \`${upiId}\`.\nNext: \`/shop add\`, then \`/shop panel\`.`)));
    }

    if (sub === 'ltc') {
      const address = interaction.options.getString('address')?.trim() ?? null;
      if (address && !ltc.isAddress(address)) return fail('Invalid Address', 'That does not look like a Litecoin address (it starts with `L`, `M` or `ltc1`).');
      db.updateGuild('shop', guild.id, (shop) => {
        shop.ltcAddress = address;
        shop.products ??= {};
      });
      audit.record(guild.id, interaction.user.id, 'shop.ltc', address ? 'enabled' : 'disabled');
      return interaction.reply(
        embeds.ephemeral(
          address
            ? embeds.success(interaction, 'Litecoin Payments Enabled', `Order tickets now have a **Pay with LTC** button.\nAddress: \`${address}\`\n\n${embeds.e('caution')} Please double-check the address. Coins sent to a wrong address are lost.`)
            : embeds.success(interaction, 'Litecoin Payments Disabled', 'Order tickets no longer offer LTC.'),
        ),
      );
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true).trim();
      if (findProduct(guild.id, name)) return fail('Already Exists', `There is already a product called **${name}**.`);
      if (productsOf(guild.id).length >= MAX_PRODUCTS) return fail('Shop Is Full', `A shop can have up to **${MAX_PRODUCTS}** products.`);
      const price = Math.round(interaction.options.getNumber('price', true) * 100) / 100;
      const stock = interaction.options.getInteger('stock') ?? -1;
      db.updateGuild('shop', guild.id, (shop) => {
        shop.counter = (shop.counter ?? 0) + 1;
        (shop.products ??= {})[`p${shop.counter}`] = { name, price, stock, description: interaction.options.getString('description')?.trim() ?? '' };
      });
      audit.record(guild.id, interaction.user.id, 'shop.product.add');
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Product Added', `**${name}** — ${rupees(price)} • ${stockText(stock)}\nRun \`/shop panel\` again to refresh the buttons.`)));
    }

    if (sub === 'remove' || sub === 'stock') {
      const found = findProduct(guild.id, interaction.options.getString('product', true));
      if (!found) return fail('Product Not Found', 'Check the name with `/shop products`.');
      const [id, product] = found;
      if (sub === 'remove') {
        db.updateGuild('shop', guild.id, (shop) => {
          delete shop.products[id];
        });
        audit.record(guild.id, interaction.user.id, 'shop.product.remove', id);
        return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Product Removed', `**${product.name}** is no longer sold.`)));
      }
      const amount = interaction.options.getInteger('amount', true);
      db.updateGuild('shop', guild.id, (shop) => {
        shop.products[id].stock = amount;
      });
      audit.record(guild.id, interaction.user.id, 'shop.stock', id);
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Stock Updated', `**${product.name}** — ${stockText(amount)}`)));
    }

    // panel
    if (!shopOf(guild.id).upiId && !shopOf(guild.id).ltcAddress) return fail('Shop Is Not Set Up', 'Run `/shop setup` (UPI) or `/shop ltc` (Litecoin) first.');
    if (!productsOf(guild.id).length) return fail('No Products', 'Add a product with `/shop add` first.');
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel?.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return fail('I Cannot Post There', `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel ?? 'that channel'}.`);
    }
    const category = interaction.options.getString('category')?.trim() || null;
    const rows = buyRows(guild.id, category);
    if (!rows.length) return fail('No Products', 'No products match that category.');
    await channel.send({ embeds: [productsEmbed(interaction, guild, category)], components: rows });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Shop Panel Posted', `Members can now order in ${channel}.`)));
  },
};
