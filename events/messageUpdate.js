/**
 * events/messageUpdate.js
 * Logs edited messages and runs automod on the new text
 * (so rules cannot be bypassed by editing a message).
 */
const { Events } = require('discord.js');
const embeds = require('../utils/embeds');
const logs = require('../commands/logs');
const automod = require('../commands/automod');

const clip = (text) => (text ? text.slice(0, 1000) : '*No text*');

module.exports = {
  name: Events.MessageUpdate,

  async execute(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.partial || newMessage.author?.bot) return;
    if (oldMessage.partial || oldMessage.content === newMessage.content) return; // embeds loading etc.

    if (await automod.check(newMessage).catch(() => false)) return;

    await logs.sendLog(newMessage.guild, {
      embeds: [
        embeds.make(newMessage, {
          color: embeds.COLORS.gold,
          title: '✏️ Message Edited',
          description: `[Jump to message](${newMessage.url})`,
          fields: [
            { name: '👤 Author', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
            { name: '💬 Channel', value: `${newMessage.channel}`, inline: true },
            { name: '⬅️ Before', value: clip(oldMessage.content) },
            { name: '➡️ After', value: clip(newMessage.content) },
          ],
          thumbnail: newMessage.author.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
