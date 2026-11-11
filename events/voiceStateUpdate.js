/**
 * events/voiceStateUpdate.js
 * 24/7 voice guard: if the BOT is disconnected, kicked or dragged to
 * another channel while 24/7 mode is on, it rejoins the saved channel.
 */
const { Events } = require('discord.js');
const db = require('../utils/db');
const voice247 = require('../commands/247vc');

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState) {
    const client = newState.client;
    if (newState.id !== client.user.id) return; // only care about the bot itself

    const saved = db.get('247vc')[newState.guild.id];
    if (!saved) return; // 24/7 mode is off in this server

    // Still in the right channel (e.g. only a mute/deafen change) -> nothing to do.
    if (newState.channelId === saved.channelId) return;

    console.log(
      `[24/7] ${newState.channelId ? 'Moved out of' : 'Disconnected from'} the 24/7 channel in "${newState.guild.name}". Rejoining shortly...`,
    );
    // Debounced; gives Discord a few seconds to settle before we rejoin.
    voice247.scheduleEnsure(newState.guild);
  },
};
