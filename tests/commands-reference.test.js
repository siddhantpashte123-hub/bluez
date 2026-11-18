const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('command reference lists all registered slash commands and options', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'COMMANDS.md'), 'utf8');
  const dir = path.join(__dirname, '..', 'commands');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  let leaves = 0;
  function check(node, command) {
    const subs = (node.options ?? []).filter(o => o.type === 1 || o.type === 2);
    if (subs.length) return subs.forEach(s => check(s, `${command} ${s.name}`));
    const args = (node.options ?? []).map(o => o.required ? `<${o.name}>` : `[${o.name}]`).join(' ');
    assert.ok(doc.includes(`\`${command}${args ? ' ' + args : ''}\``), `Missing ${command}`);
    leaves++;
  }
  for (const file of files) { const command = require(path.join(dir, file)).data.toJSON(); check(command, `/${command.name}`); }
  assert.ok(leaves > 49);
});
