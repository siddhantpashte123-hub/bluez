/**
 * index.js – entry point
 * ---------------------------------------------------------------
 * Start with:  node index.js   |   npm start   |   pm2 start index.js
 *
 * 1. Loads the token from .env (never hard-coded, never logged)
 * 2. Creates the Discord client with the required intents
 * 3. Loads every file in /commands and /events
 * 4. Logs in
 * ---------------------------------------------------------------
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

// ---- Token check (only its presence is checked, it is never printed) ----
const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token || token === 'your-bot-token-here') {
  console.error('❌ DISCORD_TOKEN is missing. Run setup.sh / setup.bat, or create a .env file (see .env.example).');
  process.exit(1);
}

// ---- Client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: /dmall + invite tracking
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: autoresponder, auto reacter, AFK
    GatewayIntentBits.GuildVoiceStates, // 24/7 voice
    GatewayIntentBits.GuildInvites, // invite tracking
  ],
  partials: [Partials.Channel],
  allowedMentions: { parse: ['users'], repliedUser: false }, // never ping @everyone / roles
});

// ---- Load slash commands ----
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const fileName of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  try {
    const command = require(path.join(commandsDir, fileName));
    if (!command?.data || typeof command.execute !== 'function') {
      console.warn(`[Loader] Skipped commands/${fileName} (missing "data" or "execute").`);
      continue;
    }
    client.commands.set(command.data.name, command);
  } catch (err) {
    console.error(`[Loader] Failed to load commands/${fileName}:`, err);
  }
}

// ---- Load events ----
const eventsDir = path.join(__dirname, 'events');
for (const fileName of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  try {
    const event = require(path.join(eventsDir, fileName));
    // Every handler is wrapped so one failing event can never crash the bot.
    const handler = async (...args) => {
      try {
        await event.execute(...args, client);
      } catch (err) {
        console.error(`[Event:${event.name}]`, err);
      }
    };
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  } catch (err) {
    console.error(`[Loader] Failed to load events/${fileName}:`, err);
  }
}

// ---- Global safety nets: log, never crash ----
client.on('error', (err) => console.error('[Client error]', err));
client.on('shardError', (err) => console.error('[Shard error]', err));
process.on('unhandledRejection', (err) => console.error('[Unhandled rejection]', err));
process.on('uncaughtException', (err) => console.error('[Uncaught exception]', err));

// ---- Clean shutdown (pm2 stop / Ctrl+C) ----
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[Bot] ${signal} received, shutting down...`);
    client.destroy().finally(() => process.exit(0));
  });
}

// ---- Login ----
client.login(token).catch((err) => {
  // Only the error code/message is printed – never the token itself.
  if (err?.code === 'TokenInvalid') {
    console.error('❌ Discord rejected the token. Reset it in the Developer Portal and run the setup script again.');
  } else if (/disallowed intents/i.test(String(err?.message))) {
    console.error('❌ Privileged intents are disabled. Enable "MESSAGE CONTENT INTENT" and "SERVER MEMBERS INTENT" in the Developer Portal → Bot.');
  } else {
    console.error('❌ Login failed:', err?.message ?? err);
  }
  process.exit(1);
});
