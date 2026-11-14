/**
 * events/guildMemberRemove.js
 * A member left (or was kicked/banned): goodbye message + leave log.
 */
const { Events } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');
const welcome = require('../commands/welcome');
const logs = require('../commands/logs');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    const { guild } = member;
    if (member.id === member.client.user.id) return; // the bot itself was removed
    const settings = db.guild('settings', guild.id);

    if (settings.goodbye?.channelId && member.user) {
      try {
        const channel = guild.channels.cache.get(settings.goodbye.channelId) ?? (await guild.channels.fetch(settings.goodbye.channelId));
        await channel.send(welcome.goodbyePayload(member, settings.goodbye));
      } catch (err) {
        console.error('[Goodbye]', err.message);
      }
    }

    const joined = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown';
    await logs.sendLog(guild, {
      embeds: [
        embeds.make(member, {
          color: embeds.COLORS.pink,
          title: '📤 Member Left',
          description: `${member.user?.tag ?? 'Unknown user'} (\`${member.id}\`)`,
          fields: [
            { name: '📅 Joined', value: joined, inline: true },
            { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
          ],
          thumbnail: member.user?.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};
