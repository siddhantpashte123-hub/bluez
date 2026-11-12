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

const giveaways = require('../commands/gcreate');
const reminders = require('../commands/remind');
const birthdays = require('../commands/birthday');

const WATCHDOG_INTERVAL_MS = 60_000;
const GIVEAWAY_CHECK_MS = 10_000;

/** Sync invites without ever throwing (missing permission is normal). */
const safeSync = (guild) => syncInvites(guild).catch(() => {});

/** Delete commands that were registered for one server only (leftovers of older bot code). */
async function clearGuildCommands(client, guild) {
  try {
    const route = Routes.applicationGuildCommands(client.user.id, guild.id);
    const existing = await client.rest.get(route);
    if (!Array.isArray(existing) || !existing.length) return;
    await client.rest.put(route, { body: [] });
    console.log(`[Commands] Removed ${existing.length} old server-only command(s) in "${guild.name}": ${existing.map((c) => `/${c.name}`).join(', ')}`);
  } catch (err) {
    console.error(`[Commands] Could not clean old commands in "${guild.name}":`, err.message);
  }
}

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

    /* ---- 1a. Remove leftover per-server commands ----
     * Older bot code may have registered commands for single servers. This bot only
     * uses GLOBAL commands, so anything left there would answer "Unknown Command".
     */
    client.on(Events.GuildCreate, (guild) => clearGuildCommands(client, guild));
    for (const guild of client.guilds.cache.values()) await clearGuildCommands(client, guild);

    /* ---- 1b. Custom emojis (tick, caution, gifts, bow) ---- */
    await embeds.loadEmojis(client).catch((err) => console.error('[Emojis]', err.message));

    /* ---- 2. Presence ---- */
    try {
      client.user.setPresence({ activities: [{ name: '/help • 24/7 online', type: ActivityType.Watching }], status: 'online' });
    } catch (err) {
      console.error('[Ready] Could not set presence:', err.message);
    }

    /* ---- 3. Invite tracking (keeps data/invites.json up to date) ---- */
    // (member joins are handled in events/guildMemberAdd.js, which also detects the inviter)
    client.on(Events.InviteCreate, (invite) => invite.guild?.invites && safeSync(invite.guild));
    client.on(Events.GuildCreate, (guild) => safeSync(guild));
    for (const guild of client.guilds.cache.values()) await safeSync(guild);

    /* ---- 3b. Giveaways: end the ones whose time is up (also after a restart) ---- */
    await giveaways.tick(client).catch((err) => console.error('[Giveaway]', err.message));
    setInterval(() => {
      giveaways.tick(client).catch((err) => console.error('[Giveaway]', err.message));
    }, GIVEAWAY_CHECK_MS);

    /* ---- 3c. Reminders ---- */
    setInterval(() => {
      reminders.tick(client).catch((err) => console.error('[Reminder]', err.message));
    }, GIVEAWAY_CHECK_MS);

    /* ---- 3d. Birthdays (one announcement per day) ---- */
    setInterval(() => {
      birthdays.tick(client).catch((err) => console.error('[Birthday]', err.message));
    }, 10 * 60_000);
    birthdays.tick(client).catch((err) => console.error('[Birthday]', err.message));

    /* ---- 4. 24/7 voice: rejoin saved channels, then keep checking ---- */
    await voice247.ensureAll(client);
    setInterval(() => {
      voice247.ensureAll(client).catch((err) => console.error('[24/7] Watchdog error:', err.message));
    }, WATCHDOG_INTERVAL_MS);

    console.log('🚀 Bot is fully ready.');
  },
};
