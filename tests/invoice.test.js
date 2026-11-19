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
  const trace = [], sent = [], replies = [];
  const member = { id: recipientId, user: { id: recipientId, bot: !!opts.bot, send: async payload => { trace.push('send'); if (opts.dmError) throw Error('closed'); sent.push(payload); } } };
  let fetchCount = 0;
  const guild = { id: gid, name: 'Old Name', iconURL: () => opts.noIcon ? null : `https://cdn.discordapp.com/icons/${gid}/abc.png`,
    fetch: async () => { if (opts.guildError) throw Error('offline'); return { ...guild, name: 'Current Server' }; },
    members: { fetch: async query => (typeof query === 'object' ? query.user : query) === issuerId ? { permissions: opts.revoked || (opts.revokeAtConfirm && ++fetchCount > 1) ? denied : allowed } : (opts.notMember ? null : member) } };
  let modalJson, result, previewPayload, selectionPrompt;
  const msg = { awaitMessageComponent: async config => {
    if (config.componentType === ComponentType.UserSelect) {
      if (opts.selectTimeout) throw Error('timeout');
      const customId = selectionPrompt.components[0].toJSON().components[0].custom_id;
      const c = { customId, user: { id: issuerId }, memberPermissions: opts.selectionDenied ? denied : allowed, values: [recipientId], update: async p => { trace.push('selection'); result = p; } };
      assert.ok(config.filter(c)); assert.equal(config.filter({ ...c, user: { id: recipientId } }), false); return c;
    }
    assert.equal(config.componentType, ComponentType.Button);
    if (opts.confirmTimeout) throw Error('timeout');
    const buttons = previewPayload.components[0].toJSON().components;
    const customId = buttons[opts.cancel ? 1 : 0].custom_id;
    const c = { customId, user: { id: issuerId }, memberPermissions: opts.confirmDenied ? denied : allowed, update: async p => { trace.push('confirmed'); result = p; } };
    assert.ok(config.filter(c)); assert.equal(config.filter({ ...c, user: { id: recipientId } }), false);
    assert.equal(sent.length, 0, 'no DM before confirmation');
    return c;
  } };
  const fields = { product: opts.product ?? 'Premium Hosting', price: opts.price ?? '1499.50', quantity: opts.quantity ?? '', extra: opts.extra ?? '', note: opts.note ?? '' };
  const form = { client, guildId: gid, user: { id: issuerId }, memberPermissions: opts.formDenied ? denied : allowed,
    fields: { getTextInputValue: k => fields[k] },
    reply: async p => { result = p; }, deferReply: async p => { trace.push(`defer:${p.flags}`); },
    editReply: async p => { result = p; replies.push(p); if (p.components?.length) { if (p.files?.length) previewPayload = p; else selectionPrompt = p; return msg; } } };
  const i = { client, guild, guildId: gid, user: { id: issuerId }, memberPermissions: opts.initialDenied ? denied : allowed,
    options: { getString: name => opts.options?.[name] ?? null, getInteger: name => opts.options?.[name] ?? null },
    reply: async p => { result = p; }, deferReply: async p => { trace.push(`defer:${p.flags}`); }, editReply: async p => { result = p; },
    showModal: async modal => { modalJson = modal.toJSON(); trace.push('modal'); },
    awaitModalSubmit: async config => { if (opts.modalTimeout) throw Error('expired'); const submission = { ...form, customId: modalJson.custom_id }; assert.ok(config.filter(submission)); assert.equal(config.filter({ ...submission, user: { id: recipientId } }), false); return form; } };
  return { i, trace, sent, replies, getResult: () => result, getPreview: () => previewPayload, getPrompt: () => selectionPrompt, getModal: () => modalJson };
}
async function withMocks(fn, opts = {}) {
  const store = require('../utils/invoice-store');
  const old = { available: cards.available, card: cards.invoiceDetailedCard, icon: invoice.fetchIcon, ...Object.fromEntries(['get','list','create','update'].map(k => [k, store[k]])) };
  let rendered; const records = {};
  try {
    cards.available = () => !opts.noCanvas;
    cards.invoiceDetailedCard = async data => { rendered = data; if (opts.renderError) throw Error('bad image'); return Buffer.from('fake PNG'); };
    invoice.fetchIcon = async () => { if (opts.iconError) throw Error('network'); return Buffer.from('logo'); };
    store.get = (g, id) => records[g]?.[id] ?? null;
    store.list = g => Object.values(records[g] ?? {});
    store.create = (g, r) => { if (opts.storeError) throw Error('storage'); (records[g] ??= {})[r.id] = structuredClone(r); };
    store.update = (g, id, fields) => { if (opts.updateError) throw Error('storage'); const r = records[g]?.[id]; if (!r) return null; Object.assign(r, fields); return r; };
    const f = fixture(opts); await fn(f, () => rendered, records);
  } finally { cards.available = old.available; cards.invoiceDetailedCard = old.card; invoice.fetchIcon = old.icon; for (const k of ['get','list','create','update']) store[k] = old[k]; }
}

test('private form, selection, preview and confirmation send an itemized branded DM', async () => {
  await withMocks(async (f, getRendered, records) => {
    await command.execute(f.i);
    assert.equal(f.trace[0], 'modal'); assert.equal(f.trace[1], 'defer:64');
    assert.deepEqual(f.getModal().components.map(r => r.components[0].custom_id), ['product','price','quantity','extra','note']);
    assert.match(JSON.stringify(f.getPrompt()), /preview and confirm/);
    assert.match(f.getPreview().content, /Premium Hosting/); assert.equal(f.getPreview().files.length, 1);
    assert.equal(f.sent.length, 1); const p = f.sent[0], data = getRendered();
    assert.equal(data.serverName, 'Current Server'); assert.equal(data.items.length, 2); assert.equal(data.totalPaise, 350000); assert.equal(data.recipientId, recipientId); assert.deepEqual(data.icon, Buffer.from('logo'));
    assert.match(p.content, /₹3,500.00/); assert.match(p.content, /Setup/); assert.match(p.content, /Please pay/); assert.match(p.content, /Payment is not verified/); assert.equal(p.files.length, 1); assert.deepEqual(p.allowedMentions, { parse: [] });
    assert.match(JSON.stringify(f.getResult()), /Invoice Sent/); assert.equal(Object.values(records[gid])[0].delivery, 'sent');
  }, { quantity: '2', extra: 'Setup | 1 | 501', note: 'Please pay' });
});

test('validation, cancellation, permissions and failures never send publicly or claim success', async () => {
  for (const opts of [{ initialDenied: true }, { formDenied: true }, { selectionDenied: true }, { revoked: true }, { revokeAtConfirm: true }, { confirmDenied: true }, { modalTimeout: true }, { selectTimeout: true }, { confirmTimeout: true }, { cancel: true }, { product: '' }, { price: '0' }, { quantity: '0' }, { extra: 'wrong' }, { noCanvas: true }, { noIcon: true }, { notMember: true }, { bot: true }, { guildError: true }, { iconError: true }, { renderError: true }, { storeError: true }, { dmError: true }]) {
    await withMocks(async (f, getRendered, records) => { await command.execute(f.i); assert.equal(f.sent.length, 0, JSON.stringify(opts)); assert.doesNotMatch(JSON.stringify(f.getResult()) ?? '', /Invoice Sent/); if (opts.dmError) assert.equal(Object.values(records[gid])[0].delivery, 'uncertain'); else assert.equal(Object.keys(records).length, 0); }, opts);
  }
  await withMocks(async f => { f.i.isPrefix = true; await command.execute(f.i); assert.match(JSON.stringify(f.getResult()), /Use Slash Command/); assert.equal(f.sent.length, 0); });
});

test('item quantities and totals use exact paise and validate notes and limits', () => {
  const result = invoice.parseItems('One', '0.10', '3', 'Two | 2 | 0.20');
  assert.equal(result.totalPaise, 70); assert.equal(result.items.length, 2);
  for (const q of ['0', '-1', '1.5', '0001', '10000']) assert.throws(() => invoice.parseItems('x', '1', q));
  assert.throws(() => invoice.parseItems('x', '99999999.99', '2'), /total/);
  assert.throws(() => invoice.parseItems('x', '1', '1', 'bad'));
  assert.throws(() => invoice.parseItems('x', '1', '1', Array(5).fill('x | 1 | 1').join('\n')));
  assert.equal(invoice.noteText(' hello '), 'hello'); assert.throws(() => invoice.noteText('x\ny')); assert.throws(() => invoice.noteText('x'.repeat(201)));
});

test('history, manual status and resend are private, server scoped, and not verification', async () => {
  await withMocks(async (f, getRendered, records) => {
    await command.execute(f.i); const id = Object.keys(records[gid])[0];
    f.i.options.getString = k => ({ action: 'history' })[k] ?? null;
    await command.execute(f.i); assert.equal(f.getResult().flags, 64); assert.match(JSON.stringify(f.getResult()), new RegExp(id));
    f.i.options.getString = k => ({ action: 'view', invoice_id: id })[k] ?? null;
    await command.execute(f.i); assert.equal(f.getResult().flags, 64); assert.match(f.getResult().content, /Premium Hosting/);
    f.i.options.getString = k => ({ action: 'status', invoice_id: id, payment_status: 'paid' })[k] ?? null;
    await command.execute(f.i); assert.equal(records[gid][id].status, 'paid'); assert.match(JSON.stringify(f.getResult()), /not verified/i);
    f.i.options.getString = k => ({ action: 'resend', invoice_id: id })[k] ?? null;
    await command.execute(f.i); assert.equal(f.sent.length, 2); assert.match(f.sent[1].content, /Paid \(staff marked, not verified\)/); assert.equal(getRendered().status, 'paid');
    f.i.guildId = '999999999999999999'; f.i.options.getString = k => ({ action: 'status', invoice_id: id, payment_status: 'unpaid' })[k] ?? null;
    await command.execute(f.i); assert.equal(records[gid][id].status, 'paid'); assert.match(JSON.stringify(f.getResult()), /Not Found/);
  });
});

test('if saving sent state fails the user is told the DM was sent', async () => {
  await withMocks(async (f, _, records) => { await command.execute(f.i); assert.equal(f.sent.length, 1); assert.match(JSON.stringify(f.getResult()), /Sent, History Not Updated/); assert.equal(Object.values(records[gid])[0].delivery, 'uncertain'); }, { updateError: true });
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

test('itemized DM escapes user markdown and disables mentions', async () => {
  await withMocks(async f => { await command.execute(f.i); const p = f.sent[0]; assert.match(p.content, /\\\*Hosting\\\*/); assert.match(p.content, /@everyone/); assert.deepEqual(p.allowedMentions, { parse: [] }); }, { product: '*Hosting* @everyone' });
});

test('maximum supported wide server and product names still render without truncation', async () => {
  if (!cards.available()) return;
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(16, 16); canvas.getContext('2d').fillRect(0, 0, 16, 16);
  const img = await cards.invoiceCard({ serverName: 'W'.repeat(100), product: 'W'.repeat(100), icon: await canvas.encode('png'), amount: '₹9,99,99,999.99', invoiceId: 'INV-0123456789ABCDEF', date: '2026-11-19', recipientId });
  assert.equal(img.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});


test('detailed card retains all five full item names and note, using responsive height', async () => {
  if (!cards.available()) return;
  const canvas = require('@napi-rs/canvas'), { PNG } = require('pngjs');
  const seed = canvas.createCanvas(16, 16); seed.getContext('2d').fillRect(0, 0, 16, 16);
  const icon = await seed.encode('png'), drawn = [], original = canvas.createCanvas;
  const items = Array.from({ length: 5 }, (_, i) => ({ name: String(i) + 'W'.repeat(99), quantity: 1, unitPaise: 100 }));
  const note = 'W'.repeat(200);
  const args = { serverName: 'W'.repeat(100), icon, items, totalPaise: 500, note, invoiceId: 'INV-0123456789ABCDEF', date: '2026-11-11', recipientId, status: 'paid' };
  try {
    canvas.createCanvas = (...args) => { const surface = original(...args), ctx = surface.getContext('2d'), old = ctx.fillText.bind(ctx); ctx.fillText = (...params) => { drawn.push(params[0]); return old(...params); }; return surface; };
    const image = PNG.sync.read(await cards.invoiceDetailedCard(args)); assert.equal(image.width, 1200); assert.equal(image.height, 940);
    for (const item of items) { const fragments = drawn.filter(v => v && (v === item.name || item.name.includes(v)) && v.startsWith(item.name[0])); assert.ok(fragments.length, `item ${item.name[0]} rendered`); }
    assert.ok(drawn.includes('PAID — STAFF MARKED (NOT VERIFIED)'));
    const smaller = PNG.sync.read(await cards.invoiceDetailedCard({ ...args, items: items.slice(0, 1), note: '' })); assert.equal(smaller.height, 620);
  } finally { canvas.createCanvas = original; }
});

test('invoice store persists server-isolated data and refuses corrupt input', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const originalDir = db.DATA_DIR, modulePath = require.resolve('../utils/invoice-store'), originalModule = require.cache[modulePath];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-test-'));
  try {
    db.DATA_DIR = temp; delete require.cache[modulePath]; const store = require('../utils/invoice-store');
    const record = { id: 'INV-0123456789ABCDEF', createdAt: new Date().toISOString(), status: 'unpaid', note: 'private' };
    store.create(gid, record); assert.equal(store.get(gid, record.id).note, 'private'); assert.equal(store.get('other', record.id), null);
    assert.throws(() => store.create(gid, record), /already exists/);
    store.update(gid, record.id, { status: 'paid' }); assert.equal(store.list(gid)[0].status, 'paid');
    assert.equal(fs.statSync(path.join(temp, 'invoices.json')).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(temp, 'invoices.json'), '{broken'); assert.throws(() => store.list(gid), /unavailable/); assert.throws(() => store.create(gid, record), /unavailable/);
  } finally { db.DATA_DIR = originalDir; require.cache[modulePath] = originalModule; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('history pages, status permissions and uncertain resend are handled privately', async () => {
  await withMocks(async (f, _, records) => {
    await command.execute(f.i); const id = Object.keys(records[gid])[0], base = records[gid][id];
    for (let n = 1; n <= 10; n++) records[gid][`INV-${String(n).padStart(16, '0')}`] = { ...base, id: `INV-${String(n).padStart(16, '0')}` };
    f.i.options.getString = k => ({ action: 'history' })[k] ?? null;
    f.i.options.getInteger = k => k === 'page' ? 2 : null;
    await command.execute(f.i); assert.equal(f.getResult().flags, 64); assert.match(JSON.stringify(f.getResult()), /Page 2\/2/);
    f.i.options.getInteger = () => null;
    f.i.options.getString = k => ({ action: 'status', invoice_id: id, payment_status: 'paid' })[k] ?? null;
    f.i.memberPermissions = denied; await command.execute(f.i); assert.equal(records[gid][id].status, 'unpaid'); assert.match(JSON.stringify(f.getResult()), /Missing Permission/);
    f.i.memberPermissions = allowed;
    f.i.options.getString = k => ({ action: 'status', invoice_id: id, payment_status: 'bogus' })[k] ?? null;
    await command.execute(f.i); assert.equal(records[gid][id].status, 'unpaid');
    f.i.options.getString = k => ({ action: 'resend', invoice_id: id })[k] ?? null;
    const recipient = await f.i.guild.members.fetch(recipientId); recipient.user.send = async () => { throw Error('closed'); };
    await command.execute(f.i); assert.equal(records[gid][id].delivery, 'uncertain'); assert.match(JSON.stringify(f.getResult()), /Resend Not Confirmed/);
  });
});
