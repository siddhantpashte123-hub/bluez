const db = require('./db');
// Explicitly recorded bot actions only. Never store tokens, payment addresses or private notes.
function record(guildId, actorId, action, detail = '') {
  db.updateGuild('botaudit', guildId, (store) => {
    (store.entries ??= []).push({ actorId, action, detail: String(detail).slice(0, 150), at: Date.now() });
    store.entries = store.entries.slice(-500);
  });
}
module.exports = { record };
