const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const db = require('../utils/db');
const stores = {};
db.get = name => stores[name] ??= {};
db.guild = (name, id) => db.get(name)[id] ?? {};
db.updateGuild = (name, id, fn) => { const g = (db.get(name)[id] ??= {}); fn(g); return g; };
const faq = require('../commands/faq'), quick = require('../commands/quickreply'), shop = require('../commands/shop'), cards = require('../utils/cards');
const gid = '123456789012345678', cid = '223456789012345678', uid = '323456789012345678', owner = '423456789012345678';
const client = { user: { username: 'Bot', displayAvatarURL: () => null } };
function mock(sub, opts = {}, admin = false) {
  const i = { guildId: gid, guild: { id: gid }, channelId: cid, client, user: { id: uid, username: 'Staff' }, member: { id: uid, roles: { cache: new Map() }, permissions: { has: () => false } }, memberPermissions: { has: bit => admin && bit === PermissionFlagsBits.ManageGuild }, options: { getSubcommand: () => sub, getString: k => opts[k] ?? null, getBoolean: k => opts[k] ?? null }, reply: async p => { i.result = p; i.replied = true; }, deferReply: async () => { i.deferred = true; }, editReply: async p => { i.result = p; } };
  return i;
}

test('FAQ set/remove admin only, public view/list, per-server isolation and safe mentions', async () => {
  const denied = mock('set', { key: 'delivery', answer: 'Hi' }); await faq.execute(denied); assert.match(JSON.stringify(denied.result), /Missing Permission/);
  const set = mock('set', { key: 'Delivery', answer: 'Hello @everyone' }, true); await faq.execute(set); assert.equal(set.result.flags, 64);
  const view = mock('view', { key: 'DELIVERY' }); await faq.execute(view); assert.match(JSON.stringify(view.result), /Hello @everyone/); assert.deepEqual(view.result.allowedMentions, { parse: [] });
  const list = mock('list'); await faq.execute(list); assert.match(JSON.stringify(list.result), /delivery/);
  view.guildId = 'other'; view.guild.id = 'other'; await faq.execute(view); assert.match(JSON.stringify(view.result), /Not Found/);
  const invalid = mock('set', { key: '__proto__', answer: 'bad' }, true); await faq.execute(invalid); assert.match(JSON.stringify(invalid.result), /FAQ Error/); assert.equal({}.polluted, undefined);
  const remove = mock('remove', { key: 'delivery' }, true); await faq.execute(remove); assert.match(JSON.stringify(remove.result), /FAQ Removed/);
  const missing = mock('view', { key: 'delivery' }); await faq.execute(missing); assert.match(JSON.stringify(missing.result), /Not Found/);
});

test('quick replies require admin to manage and authorized non-owner staff in the actual ticket to use', async () => {
  stores.tickets = { [gid]: { supportRoleId: 'global', tickets: { [cid]: { userId: owner, supportRoleId: 'specific', number: 1 } } } };
  const noAdmin = mock('set', { key: 'hello', text: 'Hello @everyone' }); await quick.execute(noAdmin); assert.match(JSON.stringify(noAdmin.result), /Missing Permission/);
  const set = mock('set', { key: 'hello', text: 'Hello @everyone' }, true); await quick.execute(set); assert.equal(set.result.flags, 64);
  const wrong = mock('send', { key: 'hello' }); wrong.member.roles.cache.set('global', {}); await quick.execute(wrong); assert.match(JSON.stringify(wrong.result), /Staff Only/);
  const staff = mock('send', { key: 'hello' }); staff.member.roles.cache.set('specific', {}); await quick.execute(staff); assert.equal(staff.result.content, 'Hello @everyone'); assert.deepEqual(staff.result.allowedMentions, { parse: [] }); assert.equal(staff.result.flags, undefined);
  staff.user.id = owner; await quick.execute(staff); assert.match(JSON.stringify(staff.result), /Staff Only/);
  const outside = mock('send', { key: 'hello' }); outside.channelId = 'wrong'; outside.member.roles.cache.set('specific', {}); await quick.execute(outside); assert.match(JSON.stringify(outside.result), /Not a Ticket/);
  const list = mock('list'); list.member.roles.cache.set('specific', {}); await quick.execute(list); assert.equal(list.result.flags, 64); assert.match(JSON.stringify(list.result), /hello/);
  list.isPrefix = true; await quick.execute(list); assert.match(JSON.stringify(list.result), /Use Slash Command/);
  const remove = mock('remove', { key: 'hello' }, true); await quick.execute(remove); assert.match(JSON.stringify(remove.result), /Removed/);
});

test('shop style requires admin, applies to image and embed, validates and resets', async () => {
  stores.shop = { [gid]: { products: { p: { name: 'Host', price: 99, stock: 1 } } } };
  const denied = mock('style', { color: '#FF0000' }); await shop.execute(denied); assert.match(JSON.stringify(denied.result), /Missing Permission/);
  const invalid = mock('style', { color: 'broken' }, true); await shop.execute(invalid); assert.match(JSON.stringify(invalid.result), /Invalid Color/);
  const set = mock('style', { color: '#123456', label: 'Our Store' }, true); await shop.execute(set); assert.equal(set.result.flags, 64);
  const prev = { available: cards.available, feature: cards.featureCard };
  try {
    let inputs; cards.available = () => true; cards.featureCard = async p => { inputs = p; return Buffer.from('fake'); };
    const product = mock('product', { product: 'Host' }); await shop.execute(product);
    assert.equal(inputs.accent, '#123456'); assert.equal(inputs.eyebrow, 'Our Store'); assert.equal(product.result.embeds[0].data.color, 0x123456); assert.equal(product.result.embeds[0].data.footer.text, 'Our Store');
  } finally { cards.available = prev.available; cards.featureCard = prev.feature; }
  const reset = mock('style', { reset: true }, true); await shop.execute(reset); assert.equal(stores.shop[gid].cardStyle, undefined);
});

test('all new command definitions serialize', () => { faq.data.toJSON(); quick.data.toJSON(); shop.data.toJSON(); });

test('FAQ and quick reply enforce size and bounded safe keys', async () => {
  const tooBig = mock('set', { key: 'a', answer: 'x'.repeat(1001) }, true); await faq.execute(tooBig); assert.match(JSON.stringify(tooBig.result), /1000/);
  const noText = mock('set', { key: 'hello', text: '  ' }, true); await quick.execute(noText); assert.match(JSON.stringify(noText.result), /1000/);
  stores.faq = { [gid]: { items: Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`q${n}`, 'answer'])) } };
  const overflow = mock('set', { key: 'more', answer: 'nope' }, true); await faq.execute(overflow); assert.match(JSON.stringify(overflow.result), /at most 40/);
  const update = mock('set', { key: 'q0', answer: 'updated' }, true); await faq.execute(update); assert.match(JSON.stringify(update.result), /FAQ Saved/);
});

test('actual prefix runner supports FAQ, quick replies and shop style', async () => {
  const prefix = require('../utils/prefix');
  const { PermissionsBitField } = require('discord.js');
  stores.tickets = { [gid]: { supportRoleId: 'specific', tickets: { [cid]: { userId: owner, supportRoleId: 'specific' } } } };
  stores.faq = {};
  const entries = [['!faq set delivery Delivery in 24 hours', /FAQ Saved/], ['!faq view delivery', /Delivery in 24 hours/], ['!quickreply set welcome Hello from staff', /Quick Reply Saved/], ['!quickreply send welcome', /Hello from staff/], ['!shop style color:#112233 label:Blue Shop', /Product Card Updated/]];
  const commands = new Map([['faq', faq], ['quickreply', quick], ['shop', shop]]);
  for (const [idx, [content, expected]] of entries.entries()) {
    const out = [], response = { edit: async p => { out.push(p); return response; } };
    const channel = { permissionsFor: () => ({ has: () => true }), send: async p => { out.push(p); return response; } };
    const author = { id: `${idx + 5}23456789012345678`, username: 'Tester' };
    const member = { id: author.id, permissions: new PermissionsBitField([PermissionFlagsBits.ManageGuild]), roles: { cache: new Map([['specific', {}]]) } };
    const msg = { content, id: 'message', client: { ...client, commands }, guild: { id: gid, members: { me: {} } }, guildId: gid, channelId: cid, channel, author, member, createdTimestamp: Date.now(), reply: async p => { out.push(p); return response; } };
    assert.equal(await prefix.handle(msg), true); assert.match(JSON.stringify(out.at(-1)), expected, content);
  }
});
