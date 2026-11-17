const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cards = require('../utils/cards');
const db = require('../utils/db');
const ltc = require('../utils/ltc');
const info = require('../commands/info');
const fun = require('../commands/fun');
const ltcCommand = require('../commands/ltc');

db.guild = () => ({});
const guildId = '123456789012345678';
const user = { id: '323456789012345678', username: 'Tester' };
const client = { user: { username: 'Bluez', displayAvatarURL: () => null }, guilds: { cache: { size: 2 } }, commands: { size: 43 }, uptime: 69_000, ws: { ping: 60 } };
function interaction(sub) {
  const i = {
    user, client, guild: { id: guildId }, guildId, member: { displayName: 'Tester' }, options: { getSubcommand: () => sub },
    replied: false, deferred: false, responses: [],
    reply: async (payload) => { i.replied = true; i.responses.push(payload); return payload; },
    deferReply: async () => { i.deferred = true; },
    editReply: async (payload) => { i.responses.push(payload); return payload; },
  };
  return i;
}
const last = (i) => i.responses.at(-1);
const fakePng = Buffer.from('89504e470d0a1a0a', 'hex');

test('all new cards render valid PNGs, including both coin sides and long names', async () => {
  if (!cards.available()) return;
  const pngs = await Promise.all([
    cards.botInfoCard({ botName: 'ঔৎ・Cutie・︶꒷ A long name '.repeat(6), servers: 2, commands: 43, uptime: '1m 9s', memory: '106 MB', nodeVersion: 'v22.23.5', discordVersion: 'v14.28.1' }),
    cards.ltcPriceCard({ inr: '₹4,182.46', usd: '$44.74' }),
    cards.coinFlipCard({ result: 'Heads', username: 'Tester' }),
    cards.coinFlipCard({ result: 'Tails', username: 'Tester' }),
  ]);
  for (const png of pngs) assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.notDeepEqual(pngs[2], pngs[3]);
});

test('/info bot uses one consistent runtime snapshot and attaches card', async () => {
  const previous = { available: cards.available, fn: cards.botInfoCard };
  let input;
  try {
    cards.available = () => true; cards.botInfoCard = async (data) => { input = data; return fakePng; };
    const i = interaction('bot'); await info.execute(i);
    const payload = last(i);
    assert.equal(i.deferred, true); assert.equal(input.servers, 2); assert.equal(input.commands, 43);
    assert.equal(payload.files[0].name, 'bot-info.png');
    assert.equal(payload.embeds[0].data.image.url, 'attachment://bot-info.png');
    assert.equal(payload.embeds[0].data.fields.find((f) => f.name.includes('Memory')).value, input.memory);
    assert.equal(payload.embeds[0].data.fields.find((f) => f.name.includes('Uptime')).value, input.uptime);
  } finally { cards.available = previous.available; cards.botInfoCard = previous.fn; }
});

test('/ltc price uses exactly the fetched rates in both card and embed', async () => {
  const previous = { available: cards.available, fn: cards.ltcPriceCard, rates: ltc.getRates };
  let input;
  try {
    cards.available = () => true; cards.ltcPriceCard = async (data) => { input = data; return fakePng; };
    ltc.getRates = async () => ({ inr: 4182.46, usd: 44.74 });
    const i = interaction('price'); await ltcCommand.execute(i);
    assert.equal(input.inr, '₹4,182.46'); assert.equal(input.usd, '$44.74');
    assert.match(JSON.stringify(last(i).embeds[0].data), /4,182.46/);
    assert.equal(last(i).embeds[0].data.image.url, 'attachment://ltc-price.png');
    assert.match(last(i).embeds[0].data.description, /cached/);
  } finally { cards.available = previous.available; cards.ltcPriceCard = previous.fn; ltc.getRates = previous.rates; }
});

test('/fun coinflip uses one independent toss for both the image and text', async () => {
  const previous = { available: cards.available, fn: cards.coinFlipCard, randomInt: crypto.randomInt };
  let input, randomCalls = 0;
  const draws = [0, 1, 1];
  try {
    cards.available = () => true; cards.coinFlipCard = async (data) => { input = data; return fakePng; };
    crypto.randomInt = (limit) => { assert.equal(limit, 2); randomCalls++; return draws.shift(); };
    for (const expected of ['Heads', 'Tails', 'Tails']) {
      const i = interaction('coinflip'); await fun.execute(i);
      assert.equal(input.result, expected);
      assert.match(last(i).embeds[0].data.description, new RegExp(expected));
      assert.equal(last(i).embeds[0].data.image.url, 'attachment://coinflip.png');
      assert.equal(last(i).embeds[0].data.thumbnail, undefined);
    }
    assert.equal(randomCalls, 3); // repeated results are allowed, with no second random call per flip
  } finally { cards.available = previous.available; cards.coinFlipCard = previous.fn; crypto.randomInt = previous.randomInt; }
});

test('both coin outcomes survive canvas and attachment failures', async () => {
  const previous = { available: cards.available, fn: cards.coinFlipCard, randomInt: crypto.randomInt };
  const oldWarn = console.warn;
  try {
    console.warn = () => {};
    cards.available = () => false; crypto.randomInt = () => 0;
    const heads = interaction('coinflip'); await fun.execute(heads);
    assert.match(last(heads).embeds[0].data.description, /Heads/);
    assert.equal(last(heads).files, undefined);
    cards.available = () => true; cards.coinFlipCard = async () => fakePng; crypto.randomInt = () => 1;
    const tails = interaction('coinflip'); let attempts = 0;
    tails.editReply = async (p) => { if (++attempts === 1) throw Error('missing Attach Files'); tails.responses.push(p); };
    await fun.execute(tails);
    assert.equal(attempts, 2); assert.match(last(tails).embeds[0].data.description, /Tails/);
    assert.equal(last(tails).embeds[0].data.image, undefined);
  } finally { cards.available = previous.available; cards.coinFlipCard = previous.fn; crypto.randomInt = previous.randomInt; console.warn = oldWarn; }
});

test('embed fallback works when optional canvas is missing for all three', async () => {
  const previous = { available: cards.available, rates: ltc.getRates };
  try {
    cards.available = () => false; ltc.getRates = async () => ({ inr: 100, usd: 2 });
    for (const [cmd, sub] of [[info, 'bot'], [ltcCommand, 'price'], [fun, 'coinflip']]) {
      const i = interaction(sub); await cmd.execute(i);
      assert.equal(last(i).files, undefined);
      assert.equal(last(i).embeds[0].data.image, undefined);
    }
  } finally { cards.available = previous.available; ltc.getRates = previous.rates; }
});

test('render failure falls back and attachment failure retries with no files', async () => {
  const previous = { available: cards.available, fn: cards.botInfoCard };
  const oldWarn = console.warn, oldError = console.error;
  try {
    console.warn = () => {}; console.error = () => {};
    cards.available = () => true; cards.botInfoCard = async () => { throw Error('failed'); };
    const a = interaction('bot'); await info.execute(a);
    assert.equal(last(a).embeds[0].data.image, undefined);
    cards.botInfoCard = async () => fakePng;
    const b = interaction('bot'); let attempts = 0;
    b.editReply = async (payload) => { attempts++; if (attempts === 1) throw Error('missing Attach Files'); b.responses.push(payload); };
    await info.execute(b);
    assert.equal(attempts, 2); assert.equal(last(b).embeds[0].data.image, undefined); assert.deepEqual(last(b).files, []);
  } finally { cards.available = previous.available; cards.botInfoCard = previous.fn; console.warn = oldWarn; console.error = oldError; }
});

test('unavailable LTC price shows error rather than a fabricated card', async () => {
  const previous = ltc.getRates, oldError = console.error;
  try {
    console.error = () => {}; ltc.getRates = async () => { throw Error('offline'); };
    const i = interaction('price'); await ltcCommand.execute(i);
    assert.match(last(i).embeds[0].data.title, /Price Not Available/);
    assert.equal(last(i).files, undefined);
  } finally { ltc.getRates = previous; console.error = oldError; }
});

test('the three image cards also work through the ! prefix runner', async () => {
  const prefix = require('../utils/prefix');
  const old = { available: cards.available, bot: cards.botInfoCard, price: cards.ltcPriceCard, coin: cards.coinFlipCard, rates: ltc.getRates };
  try {
    cards.available = () => true; cards.botInfoCard = cards.ltcPriceCard = cards.coinFlipCard = async () => fakePng;
    ltc.getRates = async () => ({ inr: 4182.46, usd: 44.74 });
    const commands = new Map([['info', info], ['ltc', ltcCommand], ['fun', fun]]);
    for (const [index, [content, file]] of [['!info bot', 'bot-info.png'], ['!ltc price', 'ltc-price.png'], ['!fun coinflip', 'coinflip.png']].entries()) {
      const outputs = [];
      const author = { id: `${index + 1}23456789012345678`, username: 'Tester' };
      const app = { ...client, commands };
      const botMember = {};
      const channel = { permissionsFor: () => ({ has: () => true }), sendTyping: async () => {}, send: async (p) => { outputs.push(p); return response; } };
      const response = { edit: async (p) => { outputs.push(p); return response; } };
      const message = { content, id: 'm', client: app, guild: { id: guildId, members: { me: botMember } }, guildId, channel, channelId: 'c', author, member: { displayName: 'Tester', permissions: { has: () => true } }, createdTimestamp: Date.now(), reply: async (p) => { outputs.push(p); return response; } };
      assert.equal(await prefix.handle(message), true);
      assert.equal(outputs.at(-1).files[0].name, file, content);
      assert.match(outputs.at(-1).embeds[0].data.image.url, /^attachment:\/\//);
    }
  } finally { cards.available = old.available; cards.botInfoCard = old.bot; cards.ltcPriceCard = old.price; cards.coinFlipCard = old.coin; ltc.getRates = old.rates; }
});
