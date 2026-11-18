const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const qrcode = require('qrcode');
const { buildQrPayloads } = require('../commands/upiqr');
const ctx = { client: { user: { username: 'Bluez', displayAvatarURL: () => null } }, guildId: '123456789012345678' };
function decode(file) {
  const png = PNG.sync.read(file.attachment);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(result, 'QR image should decode');
  return { png, value: result.data };
}
function linkOf(embed) {
  return embed.data.fields.find(f => f.name.includes('Pay Now')).value.replace(/`/g, '');
}

test('larger high-contrast QR decodes to exact visible payment URI including Unicode and note', async () => {
  const [payload] = await buildQrPayloads(ctx, 'sample@upi', 1450.25, 'राज & Co', 'Order #25 & more');
  const { png, value } = decode(payload.files[0]);
  assert.equal(png.width, 640); assert.equal(png.height, 640);
  assert.deepEqual([...png.data.subarray(0, 4)], [255, 255, 255, 255], 'white quiet zone');
  assert.equal(value, linkOf(payload.embeds[0]));
  const url = new URL(value);
  assert.equal(url.protocol, 'upi:'); assert.equal(url.searchParams.get('pa'), 'sample@upi');
  assert.equal(url.searchParams.get('pn'), 'राज & Co'); assert.equal(url.searchParams.get('am'), '1450.25'); assert.equal(url.searchParams.get('cu'), 'INR'); assert.equal(url.searchParams.get('tn'), 'Order #25 & more');
  assert.match(payload.embeds[0].data.description, /Check the recipient and amount/);
  assert.equal(payload.embeds[0].data.image.url, 'attachment://upi-qr-1.png');
});

test('split thresholds, grouping and every QR preserve amounts, notes and displayed links', async () => {
  const single = await buildQrPayloads(ctx, 'sample@upi', 2000, '', '');
  assert.equal(single.length, 1); assert.equal(single[0].embeds.length, 1);
  assert.equal(new URL(decode(single[0].files[0]).value).searchParams.get('am'), '2000');
  const chunks = await buildQrPayloads(ctx, 'sample@upi', 50000, 'Bluez', 'Order');
  assert.deepEqual(chunks.map(p => p.embeds.length), [10, 10, 6]);
  let index = 0, paise = 0;
  for (const payload of chunks) for (const [j, embed] of payload.embeds.entries()) {
    index++;
    const { png, value } = decode(payload.files[j]);
    assert.equal(png.width, 640); assert.equal(value, linkOf(embed));
    const params = new URL(value).searchParams;
    assert.equal(params.get('pa'), 'sample@upi'); assert.equal(params.get('pn'), 'Bluez');
    assert.equal(params.get('tn'), `Order (Part ${index}/26)`);
    assert.match(embed.data.title, new RegExp(`QR ${index} of 26`));
    paise += Math.round(Number(params.get('am')) * 100);
  }
  assert.equal(index, 26); assert.equal(paise, 5000000);
  const split = await buildQrPayloads(ctx, 'sample@upi', 2000.01, '', '');
  assert.deepEqual(split[0].embeds.map(e => new URL(linkOf(e)).searchParams.get('am')), ['1999', '1.01']);
});

test('original QR fallback still decodes to exactly the displayed URI on rendering error', async () => {
  const old = qrcode.toBuffer, warn = console.warn;
  try {
    qrcode.toBuffer = async () => { throw Error('render failure'); }; console.warn = () => {};
    const [payload] = await buildQrPayloads(ctx, 'sample@upi', 4000, '  Bluez  ', '  Order  ');
    for (const [i, embed] of payload.embeds.entries()) assert.equal(decode(payload.files[i]).value, linkOf(embed));
  } finally { qrcode.toBuffer = old; console.warn = warn; }
});

test('long international names and notes keep the full scannable URI without displaying a truncated payment link', async () => {
  const upiId = `${'a'.repeat(46)}@upi`, name = 'न'.repeat(60), note = 'न'.repeat(85);
  const chunks = await buildQrPayloads(ctx, upiId, 4000, name, note);
  let part = 0;
  for (const payload of chunks) {
    assert.ok(payload.embeds.reduce((sum, embed) => sum + embed.length, 0) <= 6000);
    for (const [i, embed] of payload.embeds.entries()) {
      part++;
      assert.match(linkOf(embed), /too long to display/);
      const { value } = decode(payload.files[i]); const params = new URL(value).searchParams;
      assert.equal(params.get('pa'), upiId); assert.equal(params.get('pn'), name); assert.equal(params.get('tn'), `${note} (Part ${part}/3)`);
    }
  }
  assert.equal(part, 3);
});

test('multiple embeds with longer copyable links stay under Discord total text limit', async () => {
  const chunks = await buildQrPayloads(ctx, 'sample@upi', 50000, 'न'.repeat(35), 'न'.repeat(45));
  assert.ok(chunks.length > 3, 'long embeds should split into more Discord messages');
  assert.equal(chunks.reduce((sum, p) => sum + p.embeds.length, 0), 26);
  for (const payload of chunks) {
    assert.ok(payload.embeds.length <= 10);
    assert.ok(payload.embeds.reduce((sum, embed) => sum + embed.length, 0) <= 6000);
    assert.equal(payload.embeds.length, payload.files.length);
  }
});
