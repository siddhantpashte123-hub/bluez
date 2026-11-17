const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../utils/db');
const embeds = require('../utils/embeds');
const help = require('../commands/help');

db.guild = () => ({});
const client = {
  user: { username: 'Cutie', displayAvatarURL: () => 'https://example.com/avatar.png' },
  commands: { size: 43 }, guilds: { cache: { size: 2 } }, ws: { ping: 69 },
};
const interaction = { client, guildId: '123', user: { id: '456', toString: () => '<@456>' } };
function component(page, disabled = false) { return help.card(interaction, page, disabled).components[0].toJSON(); }
function body(page, disabled = false) { return JSON.stringify(component(page, disabled)); }

test('home includes emoji on all four stats, and all 13 categories', () => {
  const json = body(0);
  for (const text of ['💎 **Commands**', '💖 **Categories**', '🚀 **Servers**', '📶 **Ping**']) assert.ok(json.includes(text), text);
  const text = component(0).components.find((entry) => entry.content?.includes('Explore your toolkit')).content;
  for (const name of ['🛡️ **Moderation**', '🚨 **Protection**', '👋 **Welcome & Roles**', '⭐ **Levels & Economy**', '🎲 **Community**', '🛒 **Shop**', '🧰 **Utility**', '🔊 **Voice**', '🤖 **Automation**', '📊 **Info**', '🎵 **Music**', '🎁 **Giveaways**', '🎫 **Tickets**']) assert.ok(text.includes(name), name);
  assert.match(json, /🎁 Explore your toolkit/);
  assert.match(json, /`43`/); assert.match(json, /`69 ms`/);
  assert.deepEqual(help.card(interaction, 0).allowedMentions, { parse: [] });
});

test('all pages build with emoji labels, menu options and navigation', () => {
  for (let page = 0; page <= 13; page++) {
    const json = component(page);
    const rows = json.components.filter((entry) => entry.type === 1);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].components[0].options.length, 14);
    assert.equal(rows[0].components[0].options.filter((option) => option.default).length, 1);
    assert.equal(rows[1].components.length, 5);
    assert.equal(rows[1].components[4].url, 'https://dsc.gg/bluehost');
    if (page) assert.match(body(page), /✅ \*\*`\//);
    const disabled = component(page, true).components.filter((entry) => entry.type === 1);
    assert.equal(disabled[0].components[0].disabled, true);
    for (const button of disabled[1].components.slice(0, 4)) assert.equal(button.disabled, true);
  }
});

test('custom application emoji resolve dynamically and missing ones fall back', async () => {
  const found = new Map(Object.values(embeds.EMOJIS).map((emoji) => [emoji.id, { id: emoji.id, name: emoji.name, animated: emoji.id === embeds.EMOJIS.boostShine.id }]));
  await embeds.loadEmojis({ application: { emojis: { fetch: async () => found } }, emojis: { cache: new Map() } });
  const json = body(0);
  for (const key of ['boostGem15', 'boostGem24', 'nitro', 'gift', 'boostShine', 'bow']) assert.ok(json.includes(embeds.EMOJIS[key].id), key);
  assert.ok(body(1).includes(embeds.EMOJIS.tick.id));
  assert.ok(json.includes(`<a:${embeds.EMOJIS.boostShine.name}:${embeds.EMOJIS.boostShine.id}>`));

  const oldWarn = console.warn;
  try {
    console.warn = () => {};
    await embeds.loadEmojis({ application: { emojis: { fetch: async () => new Map() } }, emojis: { cache: new Map() } });
  } finally { console.warn = oldWarn; }
  assert.match(body(0), /💎 \*\*Commands\*\*/);
  assert.match(body(1), /✅ \*\*`\//);
});
