const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const db = require('../utils/db');
const stores = {};
db.get = key => stores[key] ??= {};
db.guild = (key, guild) => db.get(key)[guild] ?? {};
db.update = (key, fn) => { fn(db.get(key)); return db.get(key); };
db.updateGuild = (key, guild, fn) => { const v = (db.get(key)[guild] ??= {}); fn(v); return v; };
const cards = require('../utils/cards');
const fun = require('../commands/fun');
const shop = require('../commands/shop');
const ticket = require('../commands/ticket');
const health = require('../commands/health');
const giveaways = require('../commands/gcreate');
const gid = '123456789012345678', uid = '223456789012345678', cid = '323456789012345678', buyer = '423456789012345678';
const client = { user: { username: 'Bot', displayAvatarURL: () => null }, ws: { ping: 45 }, guilds: { cache: new Map() } };
const fakePng = Buffer.from('89504e470d0a1a0a', 'hex');
function interaction(sub, opts = {}) {
  const i = { guildId: gid, channelId: cid, guild: { id: gid, name: 'Test' }, client, user: { id: uid, username: 'Test' }, member: { id: uid, displayName: 'Test', permissions: { has: () => false }, roles: { cache: new Map() } }, memberPermissions: { has: () => false }, options: { getSubcommand: () => sub, getString: k => opts[k] ?? null, getInteger: k => opts[k] ?? null, getUser: k => opts[k] ?? null },
    reply: async p => { i.result = p; i.replied = true; }, deferReply: async p => { i.deferred = true; i.deferFlags = p?.flags; }, editReply: async p => { i.result = p; } };
  return i;
}

test('feature cards generate valid PNG with long text', async () => {
  if (!cards.available()) return;
  const png = await cards.featureCard({ eyebrow: 'Dice', title: 'Result '.repeat(70), detail: 'Long description '.repeat(90), badge: '1000', footer: 'Tester' });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('dice and 8ball render same single result in image and embed, with graceful fallbacks', async () => {
  const old = { available: cards.available, feature: cards.featureCard, random: crypto.randomInt, math: Math.random, warn: console.warn };
  try {
    let input, count = 0; cards.available = () => true; cards.featureCard = async p => { input = p; return fakePng; };
    crypto.randomInt = n => { count++; assert.equal(n, 10); return 6; }; Math.random = () => 0;
    const d = interaction('dice', { sides: 10 }); await fun.execute(d);
    assert.equal(count, 1); assert.match(d.result.embeds[0].data.description, /\*\*7\*\*/); assert.equal(input.title, 'You rolled 7'); assert.equal(d.result.files[0].name, 'dice.png');
    const b = interaction('8ball', { question: 'Will it work?' }); await fun.execute(b);
    assert.match(b.result.embeds[0].data.description, /Yes, definitely/); assert.equal(input.title, 'Yes, definitely.'); assert.equal(input.detail, 'Will it work?');
    cards.available = () => false; const no = interaction('dice', { sides: 10 }); await fun.execute(no); assert.equal(no.result.files, undefined);
    cards.available = () => true; cards.featureCard = async () => { throw Error('canvas'); }; const fail = interaction('8ball', { question: 'Hi?' }); await fun.execute(fail); assert.equal(fail.result.files, undefined);
    cards.featureCard = async () => fakePng; console.warn = () => {}; let tries = 0; const retry = interaction('dice', { sides: 10 });
    retry.editReply = async p => { if (++tries === 1) throw Error('no attachment'); retry.result = p; }; await fun.execute(retry);
    assert.equal(tries, 2); assert.equal(retry.result.embeds[0].data.image, undefined);
  } finally { cards.available = old.available; cards.featureCard = old.feature; crypto.randomInt = old.random; Math.random = old.math; console.warn = old.warn; }
});

test('product details preserve price and stock and fall back to embed', async () => {
  stores.shop = { [gid]: { products: { p1: { name: 'Hosting', price: 499, stock: 3, description: 'Great plan' } } } };
  const old = { available: cards.available, feature: cards.featureCard };
  try {
    let input; cards.available = () => true; cards.featureCard = async p => { input = p; return fakePng; };
    const i = interaction('product', { product: 'Hosting' }); await shop.execute(i);
    assert.equal(input.title, 'Hosting'); assert.match(input.footer, /499/); assert.match(JSON.stringify(i.result.embeds[0].data), /3 left/);
    assert.equal(i.result.files[0].name, 'product.png');
    cards.available = () => false; const no = interaction('product', { product: 'p1' }); await shop.execute(no); assert.equal(no.result.files, undefined);
    const missing = interaction('product', { product: 'nope' }); await shop.execute(missing); assert.match(JSON.stringify(missing.result), /Product Not Found/);
  } finally { cards.available = old.available; cards.featureCard = old.feature; }
});

test('order search requires private staff access, filters, excludes own and respects ticket-specific role', async () => {
  stores.tickets = { [gid]: { supportRoleId: 'staff', tickets: { [cid]: { userId: buyer, supportRoleId: 'staff', number: 1 }, other: { userId: buyer, supportRoleId: 'special', number: 2 } } } };
  stores.orders = { [gid]: { items: { [cid]: { userId: buyer, number: 1, product: 'Hosting', price: 99, status: 'paid' }, other: { userId: buyer, number: 2, product: 'Secret', price: 7, status: 'paid' }, own: { userId: uid, number: 3, product: 'Own', price: 5, status: 'paid' } } } };
  const no = interaction('search', { status: 'paid' }); await shop.execute(no); assert.match(JSON.stringify(no.result), /Staff Only/);
  const i = interaction('search', { status: 'paid' }); i.member.roles.cache.set('staff', {}); await shop.execute(i);
  assert.equal(i.result.flags, 64); assert.match(JSON.stringify(i.result), /Hosting/); assert.doesNotMatch(JSON.stringify(i.result), /Secret|Own/);
  const n = interaction('search', { number: 1 }); n.member.roles.cache.set('staff', {}); await shop.execute(n); assert.match(JSON.stringify(n.result), /Hosting/);
  const filter = interaction('search', { customer: { id: buyer }, status: 'pending' }); filter.member.roles.cache.set('staff', {}); await shop.execute(filter); assert.match(JSON.stringify(filter.result), /No matching orders/);
  const empty = interaction('search'); empty.member.roles.cache.set('staff', {}); await shop.execute(empty); assert.match(JSON.stringify(empty.result), /Filter Required/);
  i.isPrefix = true; await shop.execute(i); assert.doesNotMatch(JSON.stringify(i.result), /Hosting/);
});

test('ticket summary is private, scoped to ticket staff, and blocks owner', async () => {
  stores.tickets = { [gid]: { supportRoleId: 'global', tickets: { [cid]: { userId: buyer, number: 4, kind: 'buy', priority: 'urgent', supportRoleId: 'special' } } } };
  stores.orders = { [gid]: { items: { [cid]: { userId: buyer, status: 'paid' } } } };
  const i = interaction('summary'); i.member.roles.cache.set('global', {}); await ticket.execute(i); assert.match(JSON.stringify(i.result), /Staff Only/);
  i.member.roles.cache.set('special', {}); await ticket.execute(i); assert.equal(i.result.flags, 64); assert.match(JSON.stringify(i.result), /urgent/); assert.match(JSON.stringify(i.result), /paid/);
  i.user.id = buyer; await ticket.execute(i); assert.match(JSON.stringify(i.result), /Staff Only/);
  i.isPrefix = true; await ticket.execute(i); assert.doesNotMatch(JSON.stringify(i.result), /urgent/);
});

test('health is private and admin only, with honest local check description', async () => {
  const i = interaction(); await health.execute(i); assert.match(JSON.stringify(i.result), /Administrator Only/);
  i.memberPermissions.has = b => b === PermissionFlagsBits.Administrator; await health.execute(i);
  assert.equal(i.deferFlags, 64); assert.match(JSON.stringify(i.result), /Gateway latency/); assert.match(JSON.stringify(i.result), /does not verify/);
  i.isPrefix = true; await health.execute(i); assert.match(JSON.stringify(i.result), /Slash Command/);
});

test('winner announcement retains buttons and winner mentions when attachment fails', async () => {
  const old = { available: cards.available, feature: cards.featureCard };
  try {
    cards.available = () => true; let input; cards.featureCard = async p => { input = p; return fakePng; };
    stores.giveaways = { m1: { guildId: gid, channelId: cid, prize: 'Prize', winners: 1, entrants: [buyer], endsAt: Date.now(), ended: false } };
    const attempts = []; const message = { edit: async () => {}, reply: async p => { attempts.push({ hasFiles: !!p.files, image: p.embeds[0].data.image?.url, components: p.components.length, mentions: p.allowedMentions.users }); if (attempts.length === 1) throw Error('attachments disabled'); } };
    const c = { ...client, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } };
    const result = await giveaways.endGiveaway(c, 'm1');
    assert.deepEqual(result.winnerIds, [buyer]); assert.match(input.detail, new RegExp(buyer)); assert.equal(attempts.length, 2); assert.equal(attempts[0].hasFiles, true); assert.equal(attempts[1].hasFiles, false); assert.equal(attempts[1].image, undefined); assert.equal(attempts[1].components, 1); assert.deepEqual(attempts[1].mentions, [buyer]);
  } finally { cards.available = old.available; cards.featureCard = old.feature; }
});

test('public image cards run through actual ! prefix runner', async () => {
  const prefix = require('../utils/prefix');
  const old = { available: cards.available, feature: cards.featureCard };
  try {
    cards.available = () => true; cards.featureCard = async () => fakePng;
    stores.shop = { [gid]: { products: { p1: { name: 'Hosting', price: 99, stock: -1 } } } };
    for (const [index, [content, filename]] of [['!fun dice 6', 'dice.png'], ['!fun 8ball Will this work?', '8ball.png'], ['!shop product Hosting', 'product.png']].entries()) {
      const outputs = [], commands = new Map([['fun', fun], ['shop', shop]]);
      const response = { edit: async p => { outputs.push(p); return response; } };
      const channel = { permissionsFor: () => ({ has: () => true }), sendTyping: async () => {}, send: async p => { outputs.push(p); return response; } };
      const message = { content, client: { ...client, commands }, guild: { id: gid, members: { me: {} } }, guildId: gid, channel, channelId: cid, author: { id: `${index + 1}23456789012345678`, username: 'Tester' }, member: { displayName: 'Tester', permissions: { has: () => true } }, createdTimestamp: Date.now(), reply: async p => { outputs.push(p); return response; } };
      assert.equal(await prefix.handle(message), true);
      assert.equal(outputs.at(-1).files[0].name, filename);
    }
  } finally { cards.available = old.available; cards.featureCard = old.feature; }
});

test('giveaway without entries never fabricates winners or buttons', async () => {
  stores.giveaways = { empty: { guildId: gid, channelId: cid, prize: 'Prize', winners: 1, entrants: [], endsAt: Date.now(), ended: false } };
  let payload; const message = { edit: async () => {}, reply: async p => { payload = p; } };
  const c = { ...client, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } };
  const result = await giveaways.endGiveaway(c, 'empty');
  assert.deepEqual(result.winnerIds, []); assert.equal(payload.files, undefined); assert.equal(payload.components.length, 0); assert.match(JSON.stringify(payload), /Nobody entered/);
});
