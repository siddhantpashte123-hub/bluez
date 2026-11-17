const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const db = require('../utils/db');
const stores = {};
db.get = (name) => stores[name] ??= {};
db.guild = (name, id) => db.get(name)[id] ?? {};
db.update = (name, fn) => { fn(db.get(name)); return db.get(name); };
db.updateGuild = (name, id, fn) => { const v = (db.get(name)[id] ??= {}); fn(v); return v; };
const shop = require('../commands/shop');
const ticket = require('../commands/ticket');
const restore = require('../utils/restore');
const inactivity = require('../utils/ticket-inactivity');
const cards = require('../utils/cards');
const help = require('../commands/help');
const gid = '123456789012345678', cid = '223456789012345678', uid = '323456789012345678';
const client = { user: { username: 'Bluez', displayAvatarURL: () => 'https://example.com/avatar.png' }, guilds: { cache: new Map() }, commands: new Map(), ws: { ping: 34 } };
function interaction(sub, options = {}) {
  const i = { guildId: gid, channelId: cid, guild: { id: gid }, client, user: { id: uid, username: 'Tester', toString: () => 'Tester' }, member: { id: uid, permissions: { has: () => false }, roles: { cache: new Map() } }, memberPermissions: { has: () => false }, options: { getSubcommand: () => sub, getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null, getBoolean: (k) => options[k] ?? null, getRole: () => null, getChannel: () => null }, reply: async (p) => { i.result = p; return p; }, editReply: async (p) => { i.result = p; return p; } };
  return i;
}

test('help home and category pages build valid Discord components', () => {
  const i = interaction('help');
  for (const page of [0, 1, 6, 13]) {
    const payload = help.card(i, page);
    const json = payload.components[0].toJSON();
    assert.ok(json.components.length >= 3);
  }
  assert.match(JSON.stringify(help.card(i, 0)), /COMMAND CENTRE/);
});

test('new server and level-up cards render PNG', async () => {
  if (!cards.available()) return;
  for (const png of await Promise.all([
    cards.serverCard({ name: 'Bluez', members: 20, boosts: 2, channels: 7, created: '2020-01-01' }),
    cards.levelUpCard({ username: 'Tester', level: 9, server: 'Bluez' }),
  ])) assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('restore preview rejects unsupported snapshots and external URLs', async () => {
  assert.throws(() => restore.plan({ version: 2 }), /supported/);
  assert.throws(() => restore.plan({ version: 1, guild: { id: gid }, roles: Array.from({ length: 26 }, () => ({ name: 'x' })), channels: [] }), /safety limit/);
  await assert.rejects(restore.readSnapshot({ name: 'snapshot.json', size: 10, url: 'https://127.0.0.1/a.json' }), /Discord attachment/);
});

test('restore only creates roles without permissions and private channels', async () => {
  const blueprint = restore.plan({ version: 1, guild: { id: gid }, roles: [{ id: gid, name: '@everyone' }, { id: 'r', name: 'Staff', permissions: '8' }, { id: 'bot', name: 'Bot', managed: true }], channels: [{ id: 'cat', name: 'private', type: 4 }, { id: 'text', name: 'general', parentId: 'cat', type: 0 }, { id: 'forum', name: 'forum', type: 15 }] });
  assert.equal(blueprint.roles.length, 1); assert.equal(blueprint.skippedChannels, 1);
  const created = [], roles = [];
  const guild = { id: gid, roles: { create: async (data) => { roles.push(data); } }, channels: { create: async (data) => { created.push(data); return { id: `new${created.length}` }; } } };
  const result = await restore.apply(guild, blueprint);
  assert.equal(result.roles, 1); assert.equal(result.channels, 2);
  assert.equal(roles[0].permissions, 0n); assert.equal(roles[0].mentionable, false);
  assert.equal(created[1].parent, 'new1');
  for (const channel of created) assert.deepEqual(channel.permissionOverwrites, [{ id: gid, deny: [PermissionFlagsBits.ViewChannel] }]);
});

test('inactivity reminder only fires once until member activity', async () => {
  const now = Date.now(); let sends = 0;
  stores.tickets = { [gid]: { inactivityHours: 1, supportRoleId: 'staff', tickets: { [cid]: { number: 4, openedAt: now - 8_000_000 } } } };
  const channel = { send: async (p) => { sends++; assert.deepEqual(p.allowedMentions.roles, ['staff']); } };
  client.guilds.cache.set(gid, { channels: { cache: new Map([[cid, channel]]) } });
  await inactivity.tick(client, now); await inactivity.tick(client, now + 60_000);
  assert.equal(sends, 1);
  inactivity.activity({ guildId: gid, channelId: cid });
  assert.equal(stores.tickets[gid].tickets[cid].alertedAt, undefined);
});

test('sales dashboard is private, admin-only and excludes pending orders', async () => {
  stores.orders = { [gid]: { items: { a: { status: 'paid', price: 90, product: 'Plan' }, b: { status: 'pending', price: 900, product: 'Other' }, c: { status: 'delivered', price: 10, product: 'Plan' } } } };
  const i = interaction('dashboard');
  await shop.execute(i); assert.match(JSON.stringify(i.result), /Missing Permission/);
  i.memberPermissions.has = () => true;
  await shop.execute(i); assert.equal(i.result.flags, 64); assert.match(JSON.stringify(i.result), /₹100/); assert.doesNotMatch(JSON.stringify(i.result), /₹900/);
  i.isPrefix = true; await shop.execute(i); assert.doesNotMatch(JSON.stringify(i.result), /₹100/);
});

test('private order note requires staff and is not shown publicly', async () => {
  stores.tickets = { [gid]: { supportRoleId: 'staff', tickets: { [cid]: { number: 1, userId: 'buyer' } } } };
  stores.orders = { [gid]: { items: { [cid]: { number: 1, userId: 'buyer', status: 'paid' } } } };
  const i = interaction('note', { text: 'private detail' });
  await ticket.execute(i); assert.match(JSON.stringify(i.result), /Staff Only/); assert.equal(db.guild('ordernotes', gid).items, undefined);
  i.member.roles.cache.set('staff', {}); await ticket.execute(i);
  assert.equal(i.result.flags, 64); assert.equal(stores.ordernotes[gid].items[cid][0].text, 'private detail');
  const view = interaction('notes', { number: 1 }); view.member.roles.cache.set('staff', {}); await shop.execute(view);
  assert.equal(view.result.flags, 64); assert.match(JSON.stringify(view.result), /private detail/);
  view.isPrefix = true; await shop.execute(view); assert.doesNotMatch(JSON.stringify(view.result), /private detail/);
});

test('ticket category questions open a modal without creating a channel', async () => {
  stores.tickets = { [gid]: { kinds: { support: { question: 'What do you need?' } }, tickets: {} } };
  let modal;
  const i = interaction(); i.customId = 'ticket_open'; i.showModal = async (m) => { modal = m.toJSON(); };
  await ticket.handleButton(i);
  assert.equal(modal.custom_id, 'ticket_question_ticket_open');
  assert.equal(modal.components[0].components[0].label, 'What do you need?');
});

test('ticket type roles cannot authorize other categories', () => {
  const member = { id: 'staffer', permissions: { has: () => false }, roles: { cache: new Map([['billing', {}]]) } };
  assert.equal(ticket.isStaff(member, { supportRoleId: 'global' }, { supportRoleId: 'billing' }), true);
  assert.equal(ticket.isStaff(member, { supportRoleId: 'global' }, { supportRoleId: 'reports' }), false);
});

test('restore confirmation requires administrator and does not apply on expiry', async () => {
  const backup = require('../commands/backup');
  const originalRead = restore.readSnapshot, originalApply = restore.apply;
  let applied = 0;
  try {
    restore.readSnapshot = async () => ({ roles: [], channels: [], skippedRoles: 0, skippedChannels: 0 });
    restore.apply = async () => { applied++; return { roles: 0, channels: 0, errors: [] }; };
    const i = interaction('restore');
    i.memberPermissions.has = () => true;
    i.guild.members = { me: { permissions: { has: () => true } } };
    i.options.getAttachment = () => ({ name: 'backup.json' });
    i.deferReply = async () => {};
    let payload;
    i.editReply = async (p) => { payload = p; return { awaitMessageComponent: async () => { throw new Error('timeout'); } }; };
    await backup.execute(i);
    assert.equal(applied, 0); assert.match(JSON.stringify(payload), /Restore Expired/);
    i.editReply = async (p) => { payload = p; return { awaitMessageComponent: async () => ({ memberPermissions: { has: () => false }, update: async (p2) => { payload = p2; } }) }; };
    await backup.execute(i);
    assert.equal(applied, 0); assert.match(JSON.stringify(payload), /Permission Changed/);
  } finally { restore.readSnapshot = originalRead; restore.apply = originalApply; }
});

test('buyer who is also staff cannot read internal notes on their own order', async () => {
  stores.tickets = { [gid]: { supportRoleId: 'staff', tickets: {} } };
  stores.orders = { [gid]: { items: { [cid]: { number: 10, userId: uid, status: 'paid' } } } };
  stores.ordernotes = { [gid]: { items: { [cid]: [{ by: 'staff', text: 'private', at: Date.now() }] } } };
  const i = interaction('notes', { number: 10 }); i.member.roles.cache.set('staff', {});
  await shop.execute(i); assert.match(JSON.stringify(i.result), /Not Allowed/); assert.doesNotMatch(JSON.stringify(i.result), /private/);
});

test('branding changes server accent without overriding error colors', async () => {
  const branding = require('../commands/branding');
  const embeds = require('../utils/embeds');
  const i = interaction('set', { color: '#123456', name: 'Premium', footer: 'Bluez Shop' });
  i.memberPermissions.has = () => true;
  await branding.execute(i);
  assert.equal(stores.settings[gid].branding.color, 0x123456);
  assert.equal(embeds.info(i, 'Info', 'text').data.color, 0x123456);
  assert.equal(embeds.error(i, 'Error', 'text').data.color, embeds.COLORS.pink);
  assert.match(JSON.stringify(help.card(i, 0)), /Premium/);
});

test('restore applies only after explicit authorized confirmation', async () => {
  const backup = require('../commands/backup');
  const originalRead = restore.readSnapshot, originalApply = restore.apply;
  let applied = 0;
  try {
    restore.readSnapshot = async () => ({ roles: [], channels: [], skippedRoles: 0, skippedChannels: 0 });
    restore.apply = async () => { applied++; return { roles: 0, channels: 0, errors: [] }; };
    const i = interaction('restore');
    i.memberPermissions.has = () => true; i.guild.members = { me: { permissions: { has: () => true } } };
    i.options.getAttachment = () => ({ name: 'backup.json' }); i.deferReply = async () => {};
    let result;
    i.editReply = async (p) => { result = p; return { awaitMessageComponent: async () => ({ memberPermissions: { has: () => true }, update: async () => {} }) }; };
    await backup.execute(i);
    assert.equal(applied, 1); assert.match(JSON.stringify(result), /Restore Finished/);
  } finally { restore.readSnapshot = originalRead; restore.apply = originalApply; }
});

test('server card retains server info fields and falls back without canvas', async () => {
  const info = require('../commands/info');
  const i = interaction('server');
  i.guild = { id: gid, name: 'Server', createdTimestamp: Date.now() - 100000, ownerId: uid, memberCount: 3, premiumTier: 0, premiumSubscriptionCount: 0, channels: { cache: new Collection() }, roles: { cache: new Collection() }, emojis: { cache: new Collection() }, iconURL: () => null, bannerURL: () => null };
  i.deferReply = async () => { i.deferred = true; };
  await info.execute(i);
  assert.match(JSON.stringify(i.result), /Server ID/);
  if (cards.available()) assert.equal(i.result.embeds[0].data.image.url, 'attachment://server.png');
});
