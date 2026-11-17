const db = require('./db');
function accent(guildId) {
  const color = db.guild('settings', guildId).branding?.color;
  return Number.isInteger(color) && color >= 0 && color <= 0xffffff ? `#${color.toString(16).padStart(6, '0')}` : undefined;
}
module.exports = { accent };
