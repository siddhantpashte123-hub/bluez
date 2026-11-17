const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const cards = require('../utils/cards');
const db = require('../utils/db');
const shop = require('../commands/shop');
const ticket = require('../commands/ticket');
const backup = require('../commands/backup');

const stores = {};
db.guild = (name, id) => stores[name]?.[id] ?? {};
db.updateGuild = (name, id, fn) => { const s = ((stores[name] ??= {})[id] ??= {}); fn(s); return s; };
const client = { user: { username: 'Bluez', displayAvatarURL: () => null } };
const guildId = '123456789012345678';
const channelId = '223456789012345678';
const userId = '323456789012345678';
function mock(sub, extra = {}) {
  return { client, guild: { id: guildId }, guildId, channelId, user: { id: userId, username: 'Customer' }, member: { id: userId, permissions: { has: () => false }, roles: { cache: new Map() } }, memberPermissions: { has: () => false }, options: { getSubcommand: () => sub }, reply: async (p) => { extra.payload = p; return p; }, update: async (p) => { extra.payload = p; return p; }, ...extra };
}

test('new cards render PNGs with missing avatar and long names', async () => {
  if (!cards.available()) return;
  const outputs = await Promise.all([
    cards.welcomeCard({ username: 'Long Name '.repeat(20), server: 'Bluez', count: 42 }),
    cards.leaderboardCard({ server: 'Bluez', entries: Array.from({ length: 10 }, (_, i) => ({ name: `User ${i}`, xp: i * 100 })) }),
    cards.profileCard({ username: 'Tester', roleCount: 3, joined: '2025-01-01', level: 2 }),
    cards.orderCard({ number: 3, product: 'Product', price: '₹1,000', status: 'PENDING', buyer: 'Customer' }),
  ]);
  for (const png of outputs) assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('feedback restricted to ticket owner and counted once', async () => {
  stores.ticketfeedback = { [guildId]: { closed: { [channelId]: { userId, rating: null, claimedBy: 'staff' } } } };
  const customId = `ticket_rating_${guildId}_${channelId}_5`;
  const other = mock(null, { customId, user: { id: '999', username: 'Other' } });
  await ticket.handleButton(other);
  assert.equal(stores.ticketfeedback[guildId].closed[channelId].rating, null);
  const owner = mock(null, { customId });
  await ticket.handleButton(owner);
  assert.equal(stores.ticketfeedback[guildId].closed[channelId].rating, 5);
  const again = mock(null, { customId: `ticket_rating_${guildId}_${channelId}_1` });
  await ticket.handleButton(again);
  assert.equal(stores.ticketfeedback[guildId].closed[channelId].rating, 5);
});

test('order history is private and only shows the caller', async () => {
  stores.orders = { [guildId]: { items: { [channelId]: { userId, number: 7, product: 'Mine', price: 50, status: 'paid', createdAt: Date.now() }, other: { userId: 'someone', number: 8, product: 'Secret', price: 10, status: 'paid', createdAt: Date.now() } } } };
  const interaction = mock('orders'); let result;
  interaction.reply = async (p) => { result = p; };
  await shop.execute(interaction);
  assert.equal(result.flags, 64);
  assert.match(result.embeds[0].data.description, /Mine/);
  assert.doesNotMatch(result.embeds[0].data.description, /Secret/);
  interaction.isPrefix = true;
  await shop.execute(interaction);
  assert.doesNotMatch(JSON.stringify(result), /Mine/);
});

test('delivered requires staff, payment and a tracked order', async () => {
  const interaction = mock('delivered'); let result;
  interaction.reply = async (p) => { result = p; };
  await shop.execute(interaction);
  assert.equal(stores.orders[guildId].items[channelId].status, 'paid');
  interaction.user = { id: 'staff' }; interaction.member.id = 'staff'; interaction.member.permissions.has = (p) => p === PermissionFlagsBits.ManageChannels;
  await shop.execute(interaction);
  assert.equal(stores.orders[guildId].items[channelId].status, 'delivered');
  assert.match(JSON.stringify(result), /Order Delivered/);
});

test('backup cannot be exported through prefix or without administrator', async () => {
  const interaction = mock('export', { isPrefix: true }); let result;
  interaction.reply = async (p) => { result = p; };
  await backup.execute(interaction);
  assert.match(JSON.stringify(result), /Slash Command/);
  interaction.isPrefix = false;
  await backup.execute(interaction);
  assert.match(JSON.stringify(result), /Administrator Only/);
});

test('coupon purchase fixes discounted price on order and rejects expired codes', async () => {
  const tickets = require('../commands/ticket');
  const oldOpen = tickets.openTicket, oldConfig = tickets.configOf, oldCard = cards.orderCard;
  const sent = [];
  try {
    stores.shop = { [guildId]: { products: { p1: { name: 'Plan', price: 200, stock: -1 } }, ltcAddress: 'test-address', coupons: { SAVE: { percent: 25, expiresAt: Date.now() + 60000 }, OLD: { percent: 90, expiresAt: Date.now() - 1 } } } };
    tickets.openTicket = async () => ({ id: channelId, send: async (payload) => sent.push(payload) });
    tickets.configOf = () => ({ tickets: { [channelId]: { number: 10, userId } } });
    cards.orderCard = async () => null;
    const interaction = mock(null, { customId: 'shop_couponbuy_p1', fields: { getTextInputValue: () => 'save' } });
    await shop.handleModal(interaction);
    assert.equal(stores.orders[guildId].items[channelId].price, 150);
    assert.equal(stores.orders[guildId].items[channelId].coupon, 'SAVE');
    assert.match(JSON.stringify(sent), /150/);
    let rejected;
    interaction.fields.getTextInputValue = () => 'old';
    interaction.reply = async (p) => { rejected = p; };
    await shop.handleModal(interaction);
    assert.match(JSON.stringify(rejected), /Invalid Coupon/);
  } finally { tickets.openTicket = oldOpen; tickets.configOf = oldConfig; cards.orderCard = oldCard; }
});

test('UPI checkout QR uses discounted amount', async () => {
  const tickets = require('../commands/ticket');
  const oldOpen = tickets.openTicket, oldConfig = tickets.configOf, oldCard = cards.orderCard;
  const sent = [];
  try {
    stores.shop = { [guildId]: { products: { p1: { name: 'Plan', price: 200, stock: -1 } }, upiId: 'shop@bank', payeeName: 'Bluez', coupons: { SAVE: { percent: 25, expiresAt: Date.now() + 60000 } } } };
    tickets.openTicket = async () => ({ id: channelId, send: async (p) => sent.push(p) });
    tickets.configOf = () => ({ tickets: { [channelId]: { number: 11, userId } } });
    cards.orderCard = async () => null;
    await shop.handleModal(mock(null, { customId: 'shop_couponbuy_p1', fields: { getTextInputValue: () => 'SAVE' } }));
    const qr = sent.find((p) => p.embeds?.some((e) => e.data.title?.includes('UPI Payment QR')));
    assert.ok(qr, 'UPI QR sent');
    assert.match(JSON.stringify(qr.embeds[0].data), /am=150/);
  } finally { tickets.openTicket = oldOpen; tickets.configOf = oldConfig; cards.orderCard = oldCard; }
});

test('LTC quote uses saved discounted amount, not current product price', async () => {
  const tickets = require('../commands/ticket');
  const ltcCommand = require('../commands/ltc');
  const oldBuild = ltcCommand.buildLtcPayload, oldConfig = tickets.configOf, oldUpdate = db.update;
  const shopPath = require.resolve('../commands/shop');
  let quoted;
  try {
    ltcCommand.buildLtcPayload = async (_ctx, _address, price) => { quoted = price; return { ltcAmount: 0.01, payload: { embeds: [] } }; };
    delete require.cache[shopPath];
    const freshShop = require('../commands/shop');
    stores.shop = { [guildId]: { products: { p1: { name: 'Plan', price: 200 } }, ltcAddress: 'test-address' } };
    stores.orders = { [guildId]: { items: { [channelId]: { userId, productId: 'p1', price: 150 } } } };
    stores.tickets = { [guildId]: { tickets: { [channelId]: { userId } } } };
    tickets.configOf = (id) => stores.tickets[id];
    db.update = (name, fn) => { fn(stores[name]); };
    const interaction = mock(null, { customId: 'shop_ltc_p1', channel: { id: channelId }, deferReply: async () => {}, editReply: async () => {} });
    await freshShop.handleButton(interaction);
    assert.equal(quoted, 150);
    assert.equal(stores.tickets[guildId].tickets[channelId].ltc.amount, 0.01);
  } finally { ltcCommand.buildLtcPayload = oldBuild; tickets.configOf = oldConfig; db.update = oldUpdate; delete require.cache[shopPath]; }
});

test('backup exports roles and overwrites privately for administrators', async () => {
  const role = { id: 'r', name: 'Role', color: 0, hoist: false, mentionable: false, position: 1, managed: false, permissions: { bitfield: 8n } };
  const channel = { id: 'c', name: 'general', type: 0, parentId: null, rawPosition: 0, permissionOverwrites: { cache: new Map([['r', { id: 'r', type: 0, allow: { bitfield: 1n }, deny: { bitfield: 2n } }]]) } };
  let deferred, result;
  const interaction = mock('export', {
    guild: { id: guildId, name: 'Bluez', roles: { fetch: async () => new Map([['r', role]]) }, channels: { fetch: async () => new Map([['c', channel]]) } },
    memberPermissions: { has: () => true },
    deferReply: async (p) => { deferred = p; }, editReply: async (p) => { result = p; },
  });
  await backup.execute(interaction);
  assert.equal(deferred.flags, 64);
  const json = JSON.parse(result.files[0].attachment.toString());
  assert.equal(json.roles[0].permissions, '8');
  assert.equal(json.channels[0].permissionOverwrites[0].deny, '2');
  assert.equal(json.guild.name, 'Bluez');
});

test('welcome card adds attachment but preserves text and mention restrictions', async () => {
  const welcome = require('../commands/welcome');
  const member = { client, id: userId, displayName: 'Tester', user: { username: 'Tester', createdTimestamp: Date.now(), displayAvatarURL: () => null }, guild: { name: 'Bluez', memberCount: 50 }, toString: () => `<@${userId}>` };
  const result = await welcome.welcomeWithCard(member, { message: 'Welcome {user} to {server}' });
  assert.equal(result.allowedMentions.users[0], userId);
  assert.match(result.embeds[0].data.description, /Bluez/);
  if (cards.available()) assert.equal(result.embeds[0].data.image.url, 'attachment://welcome.png');
});
