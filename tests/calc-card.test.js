const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../commands/calc');
const cards = require('../utils/cards');
const db = require('../utils/db');
const guildId = '123456789012345678';
const client = { user: { username: 'Bluez', displayAvatarURL: () => null }, guilds: { cache: new Map() } };
db.guild = () => ({});
function interaction(expression) {
  const i = { guildId, guild: { id: guildId }, client, user: { id: '223456789012345678', username: 'Tester' }, options: { getString: () => expression }, responses: [], replied: false, deferred: false,
    reply: async p => { i.replied = true; i.responses.push(p); },
    deferReply: async () => { i.deferred = true; },
    editReply: async p => { i.responses.push(p); } };
  return i;
}
const png = Buffer.from('89504e470d0a1a0a', 'hex');

test('calculator preserves existing math and safe parser behavior', () => {
  assert.equal(calc.evaluate('1999 * 3 + 18%'), 7076.46);
  assert.equal(calc.evaluate('sqrt(144) + 2^3'), 20);
  assert.equal(calc.evaluate('10−4÷2'), 8);
  assert.equal(calc.format(calc.evaluate('0.1 + 0.2')), '0.3');
  assert.throws(() => calc.evaluate('1/0'), /divide by zero/);
  assert.throws(() => calc.evaluate('process.exit()'), /Unknown function|understand/);
});

test('calculator generates premium PNG and does not lose unicode math operators', async () => {
  if (!cards.available()) return;
  const normal = await cards.calculatorCard({ expression: '1-2*3/4', result: '-0.5' });
  const unicode = await cards.calculatorCard({ expression: '1−2✕3÷4', result: '-0.5' });
  assert.equal(normal.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual(normal, unicode);
  await assert.rejects(cards.calculatorCard({ expression: '9*'.repeat(99) + '1', result: '1' }), /too long to render/);
});

test('slash calculator sends image only and accessible description with same input/result', async () => {
  const previous = { available: cards.available, calculatorCard: cards.calculatorCard };
  try {
    let data; cards.available = () => true; cards.calculatorCard = async d => { data = d; return png; };
    const i = interaction('500 + 18%'); await calc.execute(i);
    assert.equal(i.deferred, true); assert.equal(data.expression, '500 + 18%'); assert.equal(data.result, '590');
    const p = i.responses.at(-1); assert.equal(p.files[0].name, 'calculator.png'); assert.equal(p.files[0].description, 'Calculator: 500 + 18% = 590'); assert.equal(p.embeds, undefined);
  } finally { cards.available = previous.available; cards.calculatorCard = previous.calculatorCard; }
});

test('missing canvas, rendering failure, and attachment failure keep complete text result', async () => {
  const previous = { available: cards.available, calculatorCard: cards.calculatorCard, error: console.error, warn: console.warn };
  try {
    console.error = () => {}; console.warn = () => {};
    cards.available = () => false; const a = interaction('1+2'); await calc.execute(a);
    assert.match(JSON.stringify(a.responses.at(-1)), /Calculator/); assert.match(JSON.stringify(a.responses.at(-1)), /1\+2/); assert.match(JSON.stringify(a.responses.at(-1)), /3/);
    cards.available = () => true; cards.calculatorCard = async () => { throw Error('render failed'); };
    const b = interaction('1+2'); await calc.execute(b); assert.equal(b.deferred, true); assert.equal(b.responses.at(-1).files, undefined); assert.match(JSON.stringify(b.responses.at(-1)), /3/);
    cards.calculatorCard = async () => png; const c = interaction('1+2'); let attempts = 0;
    c.editReply = async p => { if (++attempts === 1) throw Error('no attachment permission'); c.responses.push(p); };
    await calc.execute(c); assert.equal(attempts, 2); assert.deepEqual(c.responses.at(-1).files, []); assert.match(JSON.stringify(c.responses.at(-1)), /3/);
  } finally { cards.available = previous.available; cards.calculatorCard = previous.calculatorCard; console.error = previous.error; console.warn = previous.warn; }
});

test('very long valid expressions retain a readable full-text fallback', async () => {
  if (!cards.available()) return;
  const oldError = console.error;
  try {
    console.error = () => {};
    const expression = '9*'.repeat(99) + '1';
    const i = interaction(expression); await calc.execute(i);
    const payload = i.responses.at(-1);
    assert.ok(payload.embeds); assert.equal(payload.files, undefined);
    assert.match(payload.embeds[0].data.fields[0].value, /9\*9/);
    assert.equal(payload.embeds[0].data.fields[0].value.slice(3, -3), expression);
    assert.equal(payload.embeds[0].data.fields[1].value.slice(3, -3), calc.format(calc.evaluate(expression)));
  } finally { console.error = oldError; }
});

test('invalid expression returns error without generating an image', async () => {
  const old = cards.calculatorCard; let rendered = false;
  try { cards.calculatorCard = async () => { rendered = true; return png; }; const i = interaction('1/0'); await calc.execute(i); assert.equal(rendered, false); assert.equal(i.responses.at(-1).flags, 64); assert.match(JSON.stringify(i.responses.at(-1)), /divide by zero/); }
  finally { cards.calculatorCard = old; }
});

test('!calc prefix runner sends the same image result', async () => {
  const prefix = require('../utils/prefix');
  const previous = { available: cards.available, calculatorCard: cards.calculatorCard };
  try {
    cards.available = () => true; cards.calculatorCard = async () => png;
    const outputs = [], commands = new Map([['calc', calc]]);
    const response = { edit: async p => { outputs.push(p); return response; } };
    const channel = { permissionsFor: () => ({ has: () => true }), sendTyping: async () => {}, send: async p => { outputs.push(p); return response; } };
    const message = { content: '!calc 1 + 2', client: { ...client, commands }, guild: { id: guildId, members: { me: {} } }, guildId, channel, channelId: 'c', author: { id: '523456789012345678', username: 'Tester' }, member: { displayName: 'Tester', permissions: { has: () => true } }, createdTimestamp: Date.now(), reply: async p => { outputs.push(p); return response; } };
    assert.equal(await prefix.handle(message), true); assert.equal(outputs.at(-1).files[0].name, 'calculator.png'); assert.equal(outputs.at(-1).files[0].description, 'Calculator: 1 + 2 = 3');
  } finally { cards.available = previous.available; cards.calculatorCard = previous.calculatorCard; }
});
