const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, ComponentType } = require('discord.js');
const invoice = require('../utils/invoice');
const command = require('../commands/invoice');
const cards = require('../utils/cards');
const db = require('../utils/db');
db.guild = () => ({});
const gid = '123456789012345678', issuerId = '223456789012345678', recipientId = '323456789012345678';
const allowed = { has: bit => bit === PermissionFlagsBits.ManageGuild };
const denied = { has: () => false };
const client = { user: { username: 'Bot', displayAvatarURL: () => null } };

test('price and product validation handles INR precisely and rejects ambiguous input', () => {
  for (const [input, expected] of [['0.01', 1], ['499', 49900], ['499.5', 49950], ['99999999.99', 9999999999]]) assert.equal(invoice.parsePrice(input), expected);
  assert.equal(invoice.formatPrice(invoice.parsePrice('1234567.89')), '₹12,34,567.89');
  for (const input of ['', '0', '-2', '+2', '1e3', '12.345', '1,000', '100000000', 'NaN', '₹100', '01']) assert.throws(() => invoice.parsePrice(input), /price|Price/);
  assert.equal(invoice.productName('  होस्टिंग  '), 'होस्टिंग');
  for (const input of ['', ' ', 'a\nb', 'a\x00b', 'x'.repeat(101)]) assert.throws(() => invoice.productName(input), /product name/);
});

test('server icon fetching is restricted to the correct Discord CDN path and bounded', async () => {
  const old = global.fetch; const url = `https://cdn.discordapp.com/icons/${gid}/abc.png?size=256`;
  const guild = { id: gid, iconURL: () => url };
  let called = 0;
  try {
    global.fetch = async (target, options) => { called++; assert.equal(target.toString(), url); assert.equal(options.redirect, 'error'); return new Response(Buffer.from('image')); };
    assert.equal((await invoice.fetchIcon(guild)).toString(), 'image'); assert.equal(called, 1);
    for (const bad of [null, `http://cdn.discordapp.com/icons/${gid}/abc.png`, `https://example.com/icons/${gid}/abc.png`, `https://cdn.discordapp.com/icons/other/abc.png`, `https://user@cdn.discordapp.com/icons/${gid}/abc.png`]) {
      guild.iconURL = () => bad; await assert.rejects(invoice.fetchIcon(guild));
    }
    assert.equal(called, 1, 'unsafe URLs are never fetched');
    guild.iconURL = () => url;
    global.fetch = async () => new Response(Buffer.from('x'), { headers: { 'content-length': '2000001' } });
    await assert.rejects(invoice.fetchIcon(guild), /logo/);
    global.fetch = async () => new Response(Buffer.alloc(2000001));
    await assert.rejects(invoice.fetchIcon(guild), /too large/);
    global.fetch = async () => { throw Error('network'); };
    await assert.rejects(invoice.fetchIcon(guild), /download/);
  } finally { global.fetch = old; }
});

test('invoice card requires a real logo and renders PNG with multilingual text', async () => {
  if (!cards.available()) return;
  const { createCanvas } = require('@napi-rs/canvas');
  const makeLogo = async color => { const c = createCanvas(24, 24), ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 24, 24); return c.encode('png'); };
  const args = { serverName: 'ब्लू नोड्स इंडिया', product: 'होस्टिंग प्रीमियम', amount: '₹499.00', invoiceId: 'INV-0123456789ABCDEF', date: '2026-11-19', recipientId };
  await assert.rejects(cards.invoiceCard(args), /server logo/i);
  const a = await cards.invoiceCard({ ...args, icon: await makeLogo('#ff0000') });
  const b = await cards.invoiceCard({ ...args, icon: await makeLogo('#00ff00') });
  assert.equal(a.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.notDeepEqual(a, b, 'server logo appears in the image');
});

function fixture(opts = {}) {
  const trace = [], sent = [];
  const member = { id: recipientId, user: { id: recipientId, bot: !!opts.bot, send: async payload => { if (opts.dmError) throw Error('closed'); sent.push(payload); } } };
  const guild = { id: gid, name: 'Old Name', iconURL: () => opts.noIcon ? null : `https://cdn.discordapp.com/icons/${gid}/abc.png`,
    fetch: async () => { if (opts.guildError) throw Error('offline'); return { ...guild, name: 'Current Server' }; },
    members: { fetch: async id => id === issuerId ? { permissions: opts.revoked ? denied : allowed } : (opts.notMember ? null : member) } };
  let modalJson, prompt, result;
  const msg = { awaitMessageComponent: async config => {
    assert.equal(config.componentType, ComponentType.UserSelect);
    if (opts.selectTimeout) throw Error('timeout');
    const customId = prompt.components[0].toJSON().components[0].custom_id;
    const c = { customId, user: { id: issuerId }, memberPermissions: opts.selectionDenied ? denied : allowed, values: [recipientId], update: async p => { trace.push('select-update'); result = p; } };
    assert.equal(config.filter(c), true); assert.equal(config.filter({ ...c, user: { id: recipientId } }), false);
    return c;
  } };
  const form = { client, guildId: gid, user: { id: issuerId }, memberPermissions: opts.formDenied ? denied : allowed,
    fields: { getTextInputValue: k => k === 'product' ? (opts.product ?? 'Premium Hosting') : (opts.price ?? '1499.50') },
    reply: async p => { result = p; }, deferReply: async p => { trace.push(`defer:${p.flags}`); },
    editReply: async p => { result = p; if (p.components?.length) { prompt = p; return msg; } } };
  const i = { client, guild, guildId: gid, user: { id: issuerId }, memberPermissions: opts.initialDenied ? denied : allowed,
    reply: async p => { result = p; }, showModal: async modal => { modalJson = modal.toJSON(); trace.push('modal'); },
    awaitModalSubmit: async config => { if (opts.modalTimeout) throw Error('expired'); const submission = { ...form, customId: modalJson.custom_id }; assert.equal(config.filter(submission), true); assert.equal(config.filter({ ...submission, user: { id: recipientId } }), false); return form; } };
  return { i, trace, sent, getResult: () => result, getPrompt: () => prompt, getModal: () => modalJson };
}
async function withMocks(fn, opts = {}) {
  const old = { available: cards.available, card: cards.invoiceCard, icon: invoice.fetchIcon };
  let rendered;
  try {
    cards.available = () => !opts.noCanvas;
    cards.invoiceCard = async data => { rendered = data; if (opts.renderError) throw Error('bad image'); return Buffer.from('fake PNG'); };
    invoice.fetchIcon = async guild => { if (opts.iconError) throw Error('network'); return Buffer.from('logo'); };
    const f = fixture(opts); await fn(f, () => rendered);
  } finally { cards.available = old.available; cards.invoiceCard = old.card; invoice.fetchIcon = old.icon; }
}

test('form then private recipient picker sends one branded image DM with exact amount', async () => {
  await withMocks(async (f, getRendered) => {
    await command.execute(f.i);
    assert.equal(f.trace[0], 'modal'); assert.equal(f.trace[1], 'defer:64');
    const components = f.getModal().components; assert.equal(components.length, 2); assert.deepEqual(components.map(r => r.components[0].custom_id), ['product', 'price']);
    assert.match(JSON.stringify(f.getPrompt()), /Selecting them will send/);
    assert.equal(f.sent.length, 1); const p = f.sent[0], data = getRendered();
    assert.equal(data.serverName, 'Current Server'); assert.equal(data.product, 'Premium Hosting'); assert.equal(data.amount, '₹1,499.50'); assert.equal(data.recipientId, recipientId); assert.deepEqual(data.icon, Buffer.from('logo'));
    assert.match(p.content, /Current Server/); assert.match(p.content, /₹1,499.50/); assert.match(p.content, /Payment is not verified/); assert.equal(p.files.length, 1); assert.match(p.files[0].name, /^INV-[A-F0-9]{16}\.png$/); assert.match(p.files[0].description, /Premium Hosting/); assert.deepEqual(p.allowedMentions, { parse: [] });
    assert.match(JSON.stringify(f.getResult()), /Invoice Sent/);
  });
});

test('missing permission, prefix use and expired forms never send anything', async () => {
  for (const opts of [{ initialDenied: true }, { formDenied: true }, { selectionDenied: true }, { revoked: true }, { modalTimeout: true }, { selectTimeout: true }]) await withMocks(async f => { await command.execute(f.i); assert.equal(f.sent.length, 0); }, opts);
  await withMocks(async f => { f.i.isPrefix = true; await command.execute(f.i); assert.match(JSON.stringify(f.getResult()), /Use Slash Command/); assert.equal(f.sent.length, 0); });
});

test('validation, logo, canvas, member, render and DM failures never report success or send publicly', async () => {
  for (const opts of [{ product: '' }, { price: '0' }, { noCanvas: true }, { noIcon: true }, { notMember: true }, { bot: true }, { guildError: true }, { iconError: true }, { renderError: true }, { dmError: true }]) {
    await withMocks(async f => { await command.execute(f.i); assert.equal(f.sent.length, 0, JSON.stringify(opts)); assert.doesNotMatch(JSON.stringify(f.getResult()), /Invoice Sent/); }, opts);
  }
});

test('compact landscape card preserves full long names, product, amounts and server logo', async () => {
  if (!cards.available()) return;
  const canvas = require('@napi-rs/canvas'); const { PNG } = require('pngjs');
  const seed = canvas.createCanvas(24, 24), ink = seed.getContext('2d'); ink.fillStyle = '#1464a8'; ink.fillRect(0, 0, 24, 24);
  const logo = await seed.encode('png');
  const data = { serverName: 'BLUENODES | PREMIUM HOSTING | DEVELOPMENT | FREE FOREVER', icon: logo, product: 'Premium Hosting and Development Package', amount: '₹9,99,99,999.99', invoiceId: 'INV-0123456789ABCDEF', date: '2026-11-19', recipientId };
  const original = canvas.createCanvas; const drawn = [];
  try {
    canvas.createCanvas = (...args) => {
      const surface = original(...args), context = surface.getContext('2d'), fillText = context.fillText.bind(context);
      context.fillText = (...params) => { drawn.push(params[0]); return fillText(...params); };
      return surface;
    };
    const buffer = await cards.invoiceCard(data);
    const image = PNG.sync.read(buffer); assert.equal(image.width, 1200); assert.equal(image.height, 700);
    const serverStart = drawn.indexOf('SERVER INVOICE') + 1, serverEnd = drawn.indexOf('MANUAL');
    assert.equal(drawn.slice(serverStart, serverEnd).join(''), data.serverName);
    const prodStart = drawn.indexOf('PRODUCT / SERVICE') + 1, prodEnd = drawn.indexOf('A manual invoice from this server');
    assert.equal(drawn.slice(prodStart, prodEnd).join(''), data.product);
    assert.ok(drawn.includes(data.amount)); assert.ok(drawn.includes(data.invoiceId)); assert.ok(drawn.includes(recipientId));
  } finally { canvas.createCanvas = original; }
});

test('word-aware wrapping preserves every grapheme and breaks long names safely', () => {
  const { wrapPreservingText } = require('../utils/text-layout');
  const name = 'BLUENODES | PREMIUM HOSTING | DEVELOPMENT | FREE FOREVER';
  const lines = wrapPreservingText(name, 20, s => [...s].length);
  assert.equal(lines.join(''), name);
  assert.ok(lines.every(s => [...s].length <= 20));
  assert.ok(lines.some(s => s.includes('DEVELOPMENT')));
  const original = '👩‍💻कंपनी ' + 'a'.repeat(40);
  const parts = wrapPreservingText(original, 12, s => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length);
  assert.equal(parts.join(''), original); assert.ok(parts[0].startsWith('👩‍💻'));
});

test('compact DM safely escapes formatted product while preserving invoice details', async () => {
  await withMocks(async (f, getRendered) => {
    await command.execute(f.i);
    const p = f.sent[0]; assert.match(p.content, /\\\*Hosting\\\*/); assert.match(p.content, /@everyone/);
    assert.match(p.content, /Server 123456789012345678/); assert.match(p.content, /Issuer 223456789012345678/);
    assert.match(p.content, /Payment is not verified/); assert.deepEqual(p.allowedMentions, { parse: [] });
    assert.equal(getRendered().product, '*Hosting* @everyone'); assert.match(p.files[0].description, /\*Hosting\* @everyone/);
  }, { product: '*Hosting* @everyone' });
});

test('maximum supported wide server and product names still render without truncation', async () => {
  if (!cards.available()) return;
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(16, 16); canvas.getContext('2d').fillRect(0, 0, 16, 16);
  const img = await cards.invoiceCard({ serverName: 'W'.repeat(100), product: 'W'.repeat(100), icon: await canvas.encode('png'), amount: '₹9,99,99,999.99', invoiceId: 'INV-0123456789ABCDEF', date: '2026-11-19', recipientId });
  assert.equal(img.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
