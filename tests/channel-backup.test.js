const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluez-backup-test-'));
require('../utils/db').DATA_DIR = tmp;
const backup = require('../utils/channel-backup');
const upload = require('../utils/backup-upload');
const server = require('../commands/server');
const backupCommand = require('../commands/backup');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const channel = (id, type, parentId = null) => ({ id, name: id, type, parentId, rawPosition: 0, deletable: true });
const source = { id: 'source', name: 'source' };
const sourceChannels = new Map([['cat', channel('cat', ChannelType.GuildCategory)], ['text', channel('text', ChannelType.GuildText, 'cat')], ['voice', channel('voice', ChannelType.GuildVoice)]]);
const permissions = { has: bit => bit === PermissionFlagsBits.Administrator };

test('code is private random bearer secret, persisted by hash, and survives reload', () => {
  const snapshot = backup.plan(source, sourceChannels);
  const code = backup.save(snapshot);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(backup.load(code), snapshot);
  assert.notEqual(code, backup.save(snapshot));
  assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'channel-backups.json'), 'utf8'), new RegExp(code));
  assert.throws(() => backup.load('wrong'), /Invalid backup code/);
  assert.throws(() => backup.load('a'.repeat(43)), /Invalid backup code/);
});

test('unsafe or unsupported backup and target preflight stop before changes', () => {
  assert.throws(() => backup.plan(source, new Map([['x', channel('x', 999)]])), /unsupported/);
  assert.throws(() => backup.plan(source, new Map()), /1–500/);
  assert.throws(() => backup.validate({ version: 1, sourceId: 'x', channels: [{ ...channel('x', 0), position: 0, parentId: 'missing' }] }), /category/);
  const snap = backup.plan(source, sourceChannels);
  assert.throws(() => backup.checkTarget({ id: 'source', features: [] }, snap, new Map()), /different server/);
  assert.throws(() => backup.checkTarget({ id: 'other', features: [] }, snap, new Map([['x', { ...channel('x', 0), deletable: false }]])), /cannot be deleted/);
  const forum = backup.plan(source, new Map([['f', channel('f', ChannelType.GuildForum)]]));
  assert.throws(() => backup.checkTarget({ id: 'other', features: [] }, forum, new Map()), /Community/);
});

test('replacement deletes children before categories and creates private skeleton with remapped parents', async () => {
  const actions = []; let id = 0;
  const old = [channel('oldcat', 4), channel('command', 0, 'oldcat'), channel('other', 0, 'oldcat')];
  old.forEach(c => c.delete = async () => { actions.push(`delete:${c.id}`); });
  const created = [];
  const guild = { id: 'target', channels: { create: async opts => { actions.push(`create:${opts.name}`); created.push(opts); return { id: `new${++id}` }; } } };
  const result = await backup.replace(guild, backup.plan(source, sourceChannels), old, 'command');
  assert.deepEqual(actions.slice(0, 3), ['delete:other', 'delete:oldcat', 'delete:command']);
  assert.equal(result.deleted, 3); assert.equal(result.created, 3);
  assert.equal(created.find(c => c.name === 'text').parent, 'new1');
  for (const c of created) assert.deepEqual(c.permissionOverwrites, [{ id: 'target', deny: [PermissionFlagsBits.ViewChannel] }]);
});

test('deletion error stops before creating and reports partial work', async () => {
  let created = 0;
  const old = [channel('first', 0), channel('second', 0)];
  old[0].delete = async () => {}; old[1].delete = async () => { throw new Error('denied'); };
  const result = await backup.replace({ id: 'target', channels: { create: async () => { created++; } } }, backup.plan(source, sourceChannels), old, 'none');
  assert.equal(result.deleted, 1); assert.equal(result.stopped, true); assert.equal(created, 0); assert.match(result.errors[0], /denied/);
});

test('commands are admin-only and slash-only', async () => {
  for (const command of [server, backupCommand]) {
    let reply;
    const i = { isPrefix: true, reply: async p => { reply = p; } };
    await command.execute(i); assert.match(JSON.stringify(reply), /Slash Command/);
    i.isPrefix = false; i.memberPermissions = { has: () => false };
    await command.execute(i); assert.match(JSON.stringify(reply), /Administrator Only/);
    command.data.toJSON();
  }
});

function fixture({ code, clickAdmin = true, closeDM = false, changeList = false, expire = false } = {}) {
  const calls = [], dms = [];
  const c = channel('old', 0); c.delete = async () => calls.push('delete');
  const guild = { id: 'target', name: 'Target', features: [], members: { fetchMe: async () => ({ permissions }), fetch: async () => ({ permissions }) }, channels: { fetch: async () => new Map(changeList && calls.includes('confirmed') ? [['new', channel('new', 0)]] : [['old', c]]), create: async opt => { calls.push('create'); return { id: `new-${opt.name}` }; } } };
  let prompt, edit;
  const message = { awaitMessageComponent: async ({ filter }) => { if (expire) throw Error('expired'); const click = { customId: prompt.components[0].toJSON().components[0].custom_id, user: { id: 'admin' }, memberPermissions: clickAdmin ? permissions : { has: () => false }, update: async payload => { calls.push('confirmed'); edit = payload; } }; assert.equal(filter(click), true); assert.equal(filter({ ...click, user: { id: 'other' } }), false); return click; } };
  const submission = { memberPermissions: permissions, fields: { getTextInputValue: () => code }, deferReply: async () => calls.push('defer'), editReply: async p => { edit = p; if (p.components?.length) { prompt = p; return message; } } };
  const i = { guild, channelId: 'old', user: { id: 'admin', send: async p => { if (closeDM) throw Error('closed'); dms.push(p); } }, showModal: async p => { calls.push('modal'); assert.equal(p.toJSON().components[0].components[0].custom_id, 'code'); }, awaitModalSubmit: async () => submission };
  return { i, calls, dms, getEdit: () => edit };
}

test('upload needs valid code, confirmation and working DMs; invalid, expiry and changed state never delete', async () => {
  const code = backup.save(backup.plan(source, sourceChannels));
  for (const opts of [{ code: 'invalid' }, { code, expire: true }, { code, clickAdmin: false }, { code, closeDM: true }, { code, changeList: true }]) {
    const f = fixture(opts); await upload(f.i); assert.ok(!f.calls.includes('delete'), JSON.stringify(opts));
  }
  const f = fixture({ code }); await upload(f.i);
  assert.equal(f.dms.length, 2); assert.equal(f.calls.filter(c => c === 'delete').length, 1); assert.equal(f.calls.filter(c => c === 'create').length, 3);
  assert.match(JSON.stringify(f.dms[1]), /deleted 1\/1, created 3\/3/);
  assert.doesNotMatch(JSON.stringify(f.dms), new RegExp(code));
});

test('source command saves privately and refuses to save without bot admin', async () => {
  let payload, flags;
  const i = { memberPermissions: permissions, guild: { ...source, members: { fetchMe: async () => ({ permissions }) }, channels: { fetch: async () => sourceChannels } }, deferReply: async p => { flags = p.flags; }, editReply: async p => { payload = p; } };
  await server.execute(i);
  assert.equal(flags, 64);
  const json = JSON.stringify(payload);
  const code = json.match(/[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(code); assert.equal(backup.load(code).sourceId, 'source');
  i.guild.members.fetchMe = async () => ({ permissions: { has: () => false } });
  await server.execute(i); assert.match(JSON.stringify(payload), /bot needs Administrator/);
});

test('failed category creation skips its children and continues with other channels', async () => {
  const created = [];
  const guild = { id: 'target', channels: { create: async c => { created.push(c.name); if (c.name === 'cat') throw Error('missing feature'); return { id: 'new' }; } } };
  const result = await backup.replace(guild, backup.plan(source, sourceChannels), [], 'none');
  assert.deepEqual(created, ['cat', 'voice']);
  assert.equal(result.created, 1); assert.equal(result.errors.length, 2);
});

test('a concurrent restore lock blocks destructive replacement', async () => {
  const locks = require('../utils/backup-lock');
  const code = backup.save(backup.plan(source, sourceChannels));
  const f = fixture({ code }); locks.add('target');
  try { await upload(f.i); assert.ok(!f.calls.includes('delete')); assert.match(JSON.stringify(f.getEdit()), /Restore In Progress/); }
  finally { locks.delete('target'); }
});
