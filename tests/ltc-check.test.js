const test = require('node:test');
const assert = require('node:assert/strict');
const ltc = require('../utils/ltc');
const command = require('../commands/ltc');
const cards = require('../utils/cards');
const db = require('../utils/db');
db.guild = () => ({});
const hash = 'b255126ec8fa1c75811719fd8efde98861b5cc3b528354dbf9f52aac6cf3f90c';
const address = 'L' + 'a'.repeat(33);
const other = 'M' + 'b'.repeat(33);
const client = { user: { username: 'Bot', displayAvatarURL: () => null } };
function response(value, status = 200) { return new Response(value === null ? '' : JSON.stringify(value), { status }); }
async function withFetch(handler, fn) { const old = global.fetch; global.fetch = handler; try { await fn(); } finally { global.fetch = old; } }

test('tx path and URL extraction and precise integer litoshi arithmetic', () => {
  assert.equal(ltc.extractTxid(`/tx/${hash}`), hash);
  assert.equal(ltc.extractTxid(`https://litecoinspace.org/tx/${hash.toUpperCase()}`), hash);
  assert.equal(ltc.extractTxid('bad'), '');
  assert.equal(ltc.formatSats(0), '0'); assert.equal(ltc.formatSats(1), '0.00000001');
  assert.equal(ltc.formatSats(123456789), '1.23456789'); assert.equal(ltc.formatSats(8400000000000001), '84000000.00000001');
  assert.throws(() => ltc.formatSats(-1)); assert.throws(() => ltc.sumSats([{ sats: Number.MAX_SAFE_INTEGER }, { sats: 1 }]));
});

test('LitecoinSpace gives exact outputs and tip-based confirmations without confusing change', async () => {
  const calls = [];
  await withFetch(async url => {
    calls.push(url);
    if (url.endsWith('/height')) return response(107);
    return response({ txid: hash, status: { confirmed: true, block_height: 100, block_time: 1700000000 }, vout: [{ value: 123456789, scriptpubkey_address: address }, { value: 80000000, scriptpubkey_address: other }, { value: 2 }] });
  }, async () => {
    const tx = await ltc.lookupTx(hash);
    assert.equal(tx.confirmations, 8); assert.equal(tx.confirmed, true); assert.equal(tx.source, 'LitecoinSpace');
    assert.equal(ltc.sumSats(tx.outputs), 203456791); assert.equal(ltc.sumSats(tx.outputs, address), 123456789); assert.equal(ltc.paidTo(tx, address), 1.23456789);
    assert.equal(tx.time, 1700000000000); assert.equal(calls.length, 2);
  });
});

test('unconfirmed is zero while unavailable or inconsistent tip is never invented', async () => {
  for (const [confirmed, tip, expected] of [[false, 104, 0], [true, 99, null], [true, null, null]]) {
    await withFetch(async url => url.endsWith('/height') ? (tip === null ? response({}, 500) : response(tip)) : response({ txid: hash, status: { confirmed, block_height: 100 }, vout: [{ value: 1 }] }), async () => {
      const tx = await ltc.lookupTx(hash); assert.equal(tx.confirmations, expected); assert.equal(tx.confirmed, confirmed);
    });
  }
});

test('fallback requires complete outputs, counts each output once and preserves shop address verification', async () => {
  const bc = { hash, confirmations: 3, vout_sz: 3, outputs: [{ value: 25, addresses: [address] }, { value: 100, addresses: [other] }, { value: 7, addresses: [address, other] }] };
  await withFetch(async url => url.includes('litecoinspace') ? response({}, 500) : response(bc), async () => {
    const tx = await ltc.lookupTx(hash); assert.equal(tx.source, 'BlockCypher'); assert.equal(tx.confirmations, 3); assert.equal(ltc.sumSats(tx.outputs), 132); assert.equal(ltc.sumSats(tx.outputs, address), 25); assert.equal(ltc.paidTo(tx, address), 0.00000025);
  });
  await withFetch(async url => url.includes('litecoinspace') ? response({}, 500) : response({ ...bc, vout_sz: 4 }), async () => assert.rejects(ltc.lookupTx(hash), /incomplete/i));
  await withFetch(async url => url.includes('litecoinspace') ? response({}, 500) : response({ ...bc, double_spend: true }), async () => assert.rejects(ltc.lookupTx(hash), /incomplete/i));
  await withFetch(async url => url.includes('litecoinspace') ? response({}, 500) : response({ ...bc, hash: 'f'.repeat(64) }), async () => assert.rejects(ltc.lookupTx(hash), /different transaction/i));
  await withFetch(async url => url.includes('litecoinspace') ? response({}, 500) : response({ ...bc, outputs: [{ value: -1, addresses: [address] }] }), async () => assert.rejects(ltc.lookupTx(hash)));
});

test('both 404s mean not found, mixed 404/failure is unavailable, and invalid IDs never hit network', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return response(null, 404); }, async () => { assert.equal(await ltc.lookupTx(hash), null); assert.equal(calls, 2); await assert.rejects(ltc.lookupTx('../invalid')); assert.equal(calls, 2); });
  await withFetch(async url => url.includes('litecoinspace') ? response(null, 404) : response({}, 500), async () => assert.rejects(ltc.lookupTx(hash), /unavailable/));
});

function fixture({ txid, input = `/tx/${hash}`, recipient = '', directAddress, prefix = false, timeout = false, sub = 'check' } = {}) {
  let modal, result, ack = [], edits = [];
  const ctx = { client, guildId: '123456789012345678', guild: { id: '123456789012345678' }, user: { id: '223456789012345678' }, replied: false, deferred: false,
    options: { getSubcommand: () => sub, getString: k => k === 'txid' ? txid ?? null : directAddress ?? null }, isPrefix: prefix,
    showModal: async m => { modal = m.toJSON(); },
    reply: async p => { ack.push(p); ctx.replied = true; },
    editReply: async p => { edits.push(p); result = p; },
    awaitModalSubmit: async config => {
      if (timeout) throw Error('expired');
      const form = { ...ctx, customId: modal.custom_id, fields: { getTextInputValue: k => k === 'txid' ? input : recipient } };
      form.reply = async p => { ack.push(p); form.replied = true; };
      assert.equal(config.filter(form), true); assert.equal(config.filter({ ...form, user: { id: 'different' } }), false); assert.equal(config.filter({ ...form, customId: 'other' }), false);
      return form;
    },
  };
  return { ctx, getModal: () => modal, getResult: () => result, ack, edits };
}
async function withCommandMocks(fn, options = {}) {
  const old = { lookup: ltc.lookupTx, card: cards.ltcTransactionCard, available: cards.available }; let render;
  try {
    ltc.lookupTx = async () => { if (options.failure) throw Error('offline'); return options.missing ? null : { confirmed: options.unconfirmed ? false : true, confirmations: options.count === undefined ? 6 : options.count, source: 'LitecoinSpace', outputs: [{ address, sats: 25000000 }, { address: other, sats: 100000000 }], time: null }; };
    cards.available = () => !options.noCanvas;
    cards.ltcTransactionCard = async data => { render = data; if (options.cardError) throw Error('canvas'); return Buffer.from('png'); };
    await fn(fixture(options), () => render);
  } finally { ltc.lookupTx = old.lookup; cards.ltcTransactionCard = old.card; cards.available = old.available; }
}

test('slash form accepts the /tx path and shows an image plus full accessible details', async () => {
  await withCommandMocks(async (f, getRender) => {
    await command.execute(f.ctx);
    assert.deepEqual(f.getModal().components.map(c => c.components[0].custom_id), ['txid','address']);
    assert.equal(f.ack.length, 1); const p = f.getResult(), render = getRender();
    assert.equal(render.txid, hash); assert.equal(render.amount, '1.25'); assert.equal(render.confirmations, 6);
    assert.equal(p.files.length, 1); assert.match(JSON.stringify(p.embeds), /1.25 LTC/); assert.match(JSON.stringify(p.embeds), /Confirmations/); assert.match(JSON.stringify(p.embeds), /change/);
  });
});

test('cheak spelling is a supported alias and opens the same form', async () => {
  await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.ok(f.getModal()); assert.equal(getRender().txid, hash); }, { sub: 'cheak' });
});

test('optional recipient shows exact amount to address, including zero', async () => {
  for (const [recipient, amount] of [[address, '0.25'], ['L' + 'c'.repeat(33), '0']]) await withCommandMocks(async (f, getRender) => {
    await command.execute(f.ctx); assert.equal(getRender().amount, amount); assert.equal(getRender().total, '1.25'); assert.match(JSON.stringify(f.getResult()), new RegExp(amount.replace('.', '\\.') + ' LTC'));
  }, { recipient });
});

test('direct slash and ! prefix retain support; invalid and timed out forms avoid lookups', async () => {
  await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.equal(f.getModal(), undefined); assert.equal(getRender().txid, hash); }, { txid: hash, directAddress: address });
  await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.equal(f.getModal(), undefined); assert.equal(getRender().txid, hash); }, { txid: hash, prefix: true });
  await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.equal(getRender(), undefined); assert.match(JSON.stringify(f.ack), /Slash Form/); }, { prefix: true });
  for (const options of [{ input: 'bad' }, { recipient: 'bad' }, { timeout: true }, { directAddress: 'bad' }]) await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.equal(getRender(), undefined); assert.equal(f.getResult(), undefined); }, options);
});

test('unknown confirmations, not found, provider and image failures are truthful', async () => {
  await withCommandMocks(async (f, getRender) => { await command.execute(f.ctx); assert.equal(getRender().confirmations, null); assert.match(JSON.stringify(f.getResult()), /Unavailable/); }, { count: null });
  for (const opts of [{ missing: true }, { failure: true }]) await withCommandMocks(async f => { await command.execute(f.ctx); assert.match(JSON.stringify(f.getResult()), opts.missing ? /Transaction Not Found/ : /Explorer Not Available/); }, opts);
  for (const opts of [{ noCanvas: true }, { cardError: true }]) await withCommandMocks(async f => { await command.execute(f.ctx); assert.equal(f.getResult().files, undefined); assert.match(JSON.stringify(f.getResult()), /Confirmations/); }, opts);
});

test('rendered transaction card is a PNG and contains complete hash, amounts and confirmation state', async () => {
  if (!cards.available()) return;
  const canvas = require('@napi-rs/canvas'), { PNG } = require('pngjs'); const original = canvas.createCanvas, drawn = [];
  try {
    canvas.createCanvas = (...args) => { const c = original(...args), ctx = c.getContext('2d'), fill = ctx.fillText.bind(ctx); ctx.fillText = (...params) => { drawn.push(params[0]); return fill(...params); }; return c; };
    const png = await cards.ltcTransactionCard({ txid: hash, amount: '0.25', total: '1.25', address, confirmations: 6, confirmed: true, source: 'LitecoinSpace' });
    const image = PNG.sync.read(png); assert.equal(image.width, 1200); assert.equal(image.height, 700);
    assert.ok(drawn.includes(hash.slice(0, 32))); assert.ok(drawn.includes(hash.slice(32))); assert.ok(drawn.includes('0.25 LTC')); assert.ok(drawn.includes('6')); assert.ok(drawn.includes(address));
    drawn.length = 0; await cards.ltcTransactionCard({ txid: hash, amount: '1.25', total: '1.25', address: '', confirmations: null, confirmed: true, source: 'LitecoinSpace' });
    assert.ok(drawn.includes('Unavailable')); assert.ok(drawn.includes('TOTAL TRANSACTION OUTPUTS')); assert.ok(drawn.includes('Includes change and possibly other recipients.'));
  } finally { canvas.createCanvas = original; }
});
