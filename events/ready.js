/**
 * events/ready.js
 * Runs once when the bot is logged in:
 *   1. Registers all slash commands globally (REST)
 *   2. Sets the presence
 *   3. Starts invite tracking
 *   4. Rejoins every saved 24/7 voice channel + starts the watchdog
 */
const { Events, Routes, ActivityType } = require('discord.js');
const embeds = require('../utils/embeds');
const { syncInvites } = require('../commands/invites');
const voice247 = require('../commands/247vc');

const WATCHDOG_INTERVAL_MS = 60_000;

/** Sync invites without ever throwing (missing permission is normal). */
const safeSync = (guild) => syncInvites(guild).catch(() => {});

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} server(s).`);

    /* ---- 1. Global slash command registration ---- */
    try {
      const body = client.commands.map((command) => command.data.toJSON());
      await client.rest.put(Routes.applicationCommands(client.user.id), { body });
      console.log(`✅ Registered ${body.length} global slash commands.`);
    } catch (err) {
      console.error('❌ Failed to register slash commands:', err.message);
    }

    /* ---- 1b. Custom emojis (tick, caution, gifts, bow) ---- */
    await embeds.loadEmojis(client).catch((err) => console.error('[Emojis]', err.message));

    /* ---- 2. Presence ---- */
    try {
      client.user.setPresence({ activities: [{ name: '/help • 24/7 online', type: ActivityType.Watching }], status: 'online' });
    } catch (err) {
      console.error('[Ready] Could not set presence:', err.message);
    }

    /* ---- 3. Invite tracking (keeps data/invites.json up to date) ---- */
    client.on(Events.GuildMemberAdd, (member) => safeSync(member.guild)); // someone joined -> an invite's "uses" went up
    client.on(Events.InviteCreate, (invite) => invite.guild?.invites && safeSync(invite.guild));
    client.on(Events.GuildCreate, (guild) => safeSync(guild));
    for (const guild of client.guilds.cache.values()) await safeSync(guild);

    /* ---- 4. 24/7 voice: rejoin saved channels, then keep checking ---- */
    await voice247.ensureAll(client);
    setInterval(() => {
      voice247.ensureAll(client).catch((err) => console.error('[24/7] Watchdog error:', err.message));
    }, WATCHDOG_INTERVAL_MS);

    console.log('🚀 Bot is fully ready.');
  },
};
