const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluez-upi-test-'));
require('../utils/db').DATA_DIR = dir;
const settings = require('../utils/upi-settings');
const upiset = require('../commands/upiset');
const upiqr = require('../commands/upiqr');
const gid = '123456789012345678', otherGuild = '223456789012345678', uid = '323456789012345678', otherUser = '423456789012345678';
const client = { user: { username: 'Bluez', displayAvatarURL: () => null } };
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
function interaction(opts = {}, guildId = gid, userId = uid) {
  const i = { client, guildId, guild: { id: guildId }, user: { id: userId, username: 'User' }, options: { getString: k => opts[k] ?? null, getNumber: k => opts[k] ?? null }, outputs: [], reply: async p => { i.outputs.push(p); }, editReply: async p => { i.outputs.push(p); }, followUp: async p => { i.outputs.push(p); } };
  return i;
}
const last = i => i.outputs.at(-1);
const fields = i => last(i).embeds[0].data.fields;

test('slash builders accept amount alone, ID and optional name', () => {
  const q = upiqr.data.toJSON().options;
  assert.deepEqual(q.map(o => [o.name, !!o.required]), [['amount', true], ['upi_id', false], ['name', false]]);
  assert.deepEqual(upiset.data.toJSON().options.map(o => [o.name, !!o.required]), [['upi_id', true], ['name', false]]);
});

test('upiset validates ID and persists isolated per-user/per-server settings across process restart', async () => {
  const invalid = interaction({ upi_id: 'bad@' }); await upiset.execute(invalid); assert.match(JSON.stringify(last(invalid)), /Invalid Payment Details/);
  const i = interaction({ upi_id: ' alice@bank ', name: 'Alice' }); await upiset.execute(i);
  assert.equal(last(i).flags, 64); assert.deepEqual(settings.get(gid, uid), { upiId: 'alice@bank', name: 'Alice' });
  assert.equal(settings.get(gid, otherUser), null); assert.equal(settings.get(otherGuild, uid), null);
  const out = execFileSync(process.execPath, ['-e', `require('./utils/db').DATA_DIR = ${JSON.stringify(dir)}; process.stdout.write(JSON.stringify(require('./utils/upi-settings').get(${JSON.stringify(gid)}, ${JSON.stringify(uid)})))`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { upiId: 'alice@bank', name: 'Alice' });
  assert.equal(fs.statSync(path.join(dir, 'upi-settings.json')).mode & 0o777, 0o600);
});

test('amount-only uses saved ID/name, manual override does not inherit saved name', async () => {
  const i = interaction({ amount: 499 }); await upiqr.execute(i);
  assert.equal(fields(i).find(f => f.name.includes('UPI ID')).value, '`alice@bank`');
  assert.equal(fields(i).find(f => f.name.includes('Payee')).value, 'Alice');
  assert.match(fields(i).find(f => f.name.includes('Pay Now')).value, /pn=Alice/);
  const alt = interaction({ amount: 42, upi_id: 'other@bank' }); await upiqr.execute(alt);
  assert.equal(fields(alt).find(f => f.name.includes('UPI ID')).value, '`other@bank`');
  assert.equal(fields(alt).find(f => f.name.includes('Payee')).value, 'Not specified');
  assert.doesNotMatch(fields(alt).find(f => f.name.includes('Pay Now')).value, /pn=/);
  assert.equal(settings.get(gid, uid).upiId, 'alice@bank');
  const named = interaction({ amount: 1, upi_id: 'other@bank', name: 'Other' }); await upiqr.execute(named); assert.equal(fields(named).find(f => f.name.includes('Payee')).value, 'Other');
});

test('new ID without name clears old name; missing setting and bad ID fail safely', async () => {
  await upiset.execute(interaction({ upi_id: 'new@upi' }));
  assert.deepEqual(settings.get(gid, uid), { upiId: 'new@upi', name: '' });
  const no = interaction({ amount: 10 }, otherGuild, uid); await upiqr.execute(no); assert.match(JSON.stringify(last(no)), /Set Your UPI ID First/); assert.equal(last(no).flags, 64);
  const bad = interaction({ upi_id: 'invalid!', amount: 10 }); await upiqr.execute(bad); assert.match(JSON.stringify(last(bad)), /Invalid Payment Details/);
});

test('storage failures never claim a setting was saved and leave existing saved data intact', async () => {
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = () => { throw Error('disk full'); };
    const i = interaction({ upi_id: 'other@bank' }); await upiset.execute(i); assert.match(JSON.stringify(last(i)), /Could Not Save/);
  } finally { fs.writeFileSync = original; }
  assert.equal(settings.get(gid, uid).upiId, 'new@upi');
});

test('split QR remains functional with saved ID', async () => {
  const i = interaction({ amount: 4000 }); await upiqr.execute(i);
  const payload = last(i); assert.equal(payload.embeds.length, 3); assert.match(payload.embeds[0].data.description, /split into \*\*3\*\*/);
  for (const e of payload.embeds) assert.equal(e.data.fields.find(f => f.name.includes('UPI ID')).value, '`new@upi`');
});

test('actual prefix runner supports saved amount-only, old positional and set with optional name', async () => {
  const prefix = require('../utils/prefix');
  const commands = new Map([['upiset', upiset], ['upiqr', upiqr]]);
  for (const [idx, [content, expected]] of [['!upiset demo@upi Demo Name', /UPI ID Saved/], ['!upiqr 350', /new@upi/], ['!upiqr legacy@upi 100 Old Name', /legacy@upi/]].entries()) {
    const out = [], response = { edit: async p => { out.push(p); return response; } };
    const channel = { permissionsFor: () => ({ has: () => true }), send: async p => { out.push(p); return response; } };
    const authorId = idx === 1 ? uid : `${idx + 5}23456789012345678`;
    const m = { content, id: 'm', client: { ...client, commands }, guild: { id: gid, members: { me: {} } }, guildId: gid, channelId: 'channel', channel, author: { id: authorId, username: 'Tester' }, member: { permissions: { has: () => true } }, createdTimestamp: Date.now(), reply: async p => { out.push(p); return response; } };
    assert.equal(await prefix.handle(m), true); assert.match(JSON.stringify(out.at(-1)), expected, content);
    if (idx === 0) assert.deepEqual(settings.get(gid, authorId), { upiId: 'demo@upi', name: 'Demo Name' });
    if (idx === 2) assert.match(JSON.stringify(out.at(-1)), /Old Name/);
  }
});
