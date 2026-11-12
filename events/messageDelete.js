/**
 * events/messageDelete.js
 * Logs deleted messages (only messages the bot saw since its last start).
 */
const { Events } = require('discord.js');
const embeds = require('../utils/embeds');
const logs = require('../commands/logs');
const db = require('../utils/db');

module.exports = {
  name: Events.MessageDelete,

  async execute(message) {
    if (!message.guild || message.partial || message.author?.bot) return;
    if (message.channelId === db.guild('settings', message.guild.id).logChannelId) return;
    const files = [...message.attachments.values()].map((a) => a.url);
    if (!message.content && !files.length) return;

    await logs.sendLog(message.guild, {
      embeds: [
        embeds.make(message, {
          color: embeds.COLORS.pink,
          title: '🗑️ Message Deleted',
          description: message.content ? message.content.slice(0, 3500) : '*No text*',
          fields: [
            { name: '👤 Author', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
            { name: '💬 Channel', value: `${message.channel}`, inline: true },
            ...(files.length ? [{ name: '📎 Attachments', value: files.join('\n').slice(0, 1000) }] : []),
          ],
          thumbnail: message.author.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
