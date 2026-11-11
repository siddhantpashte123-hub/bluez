/**
 * /247 vc join <voice_channel>   – join a voice channel and stay 24/7
 * /247 vc stop                   – leave and turn 24/7 mode off
 *
 * (Discord does not allow "/" or spaces inside a command name, so
 *  "/24/7 vc" is registered as the command "247" + group "vc".)
 *
 * How the bot stays connected:
 *   1. PRIMARY  – discord-audio-stream's AudioManager plays a looped
 *                 silent track through ffmpeg (needs Node 22.12+ and
 *                 the ffmpeg-static binary).
 *   2. FALLBACK – if that is unavailable, @discordjs/voice plays an
 *                 endless stream of silent Opus frames (no ffmpeg).
 *
 * Auto-reconnect is handled by `ensure()`, which is triggered from:
 *   - connection.on('disconnected')        (this file)
 *   - events/voiceStateUpdate.js           (bot kicked / moved)
 *   - events/ready.js                      (startup + 60s watchdog)
 *
 * Storage (data/247vc.json):  { "<guildId>": { "channelId": "..." } }
 */
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const CONNECT_TIMEOUT_MS = 20_000;
const RECOVERY_WINDOW_MS = 5_000; // time Discord gets to recover a dropped connection by itself
const RECONNECT_DELAY_MS = 6_000; // wait before we force a rejoin
const SILENCE_WAV = path.join(db.DATA_DIR, 'silence.wav');
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]); // one 20ms Opus frame of silence

/** guildId -> { channelId, engine, stop(), alive() } */
const sessions = new Map();
/** guilds that are currently (re)connecting */
const busy = new Set();
/** guildId -> pending reconnect timer */
const timers = new Map();

/* ------------------------------------------------------------------ */
/*  Silent audio sources                                               */
/* ------------------------------------------------------------------ */

/** Create data/silence.wav (1s, 48kHz, stereo, 16-bit) if it is missing. */
function ensureSilenceFile() {
  if (fs.existsSync(SILENCE_WAV)) return SILENCE_WAV;
  const sampleRate = 48000;
  const channels = 2;
  const dataSize = sampleRate * channels * 2; // 1 second of zeros
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  wav.writeUInt16LE(channels * 2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(SILENCE_WAV, wav);
  return SILENCE_WAV;
}

/** Endless stream of silent Opus frames (used by the fallback engine). */
class SilenceStream extends Readable {
  constructor() {
    super({ objectMode: true, highWaterMark: 8 });
  }
  _read() {
    this.push(SILENCE_FRAME);
  }
}

/* ------------------------------------------------------------------ */
/*  Engine 1: discord-audio-stream                                     */
/* ------------------------------------------------------------------ */

/** discord-audio-stream needs Node >= 22.12 and a working ffmpeg binary. */
function audioStreamSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) return false;
  try {
    const ffmpegPath = require('ffmpeg-static');
    return typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath);
  } catch {
    return false;
  }
}

async function startAudioStreamEngine(guild, channelId) {
  const { AudioManager } = require('discord-audio-stream');

  const manager = new AudioManager({
    connection: { guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator },
    source: { type: 'file', path: ensureSilenceFile() },
    ffmpeg: {
      mode: 'static',
      // -re = real-time, -stream_loop -1 = loop the silent track forever
      inputArgs: ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-stream_loop', '-1'],
    },
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    reconnectAttempts: 0, // reconnecting is done by ensure() below (single source of truth)
    onError: (err) => {
      console.error(`[24/7] Audio error in "${guild.name}":`, err.message);
      scheduleEnsure(guild);
    },
  });

  try {
    await manager.start();
  } catch (err) {
    manager.dispose();
    throw err;
  }

  // Extra safety net on top of the library's own handling.
  getVoiceConnection(guild.id)?.on(VoiceConnectionStatus.Disconnected, () => scheduleEnsure(guild));

  return {
    engine: 'discord-audio-stream',
    stop: () => manager.dispose(),
    alive: () => manager.isConnected,
    // If ffmpeg ever exits, start the silent track again.
    heal: () => {
      if (manager.isConnected && !manager.isPlaying) manager.play().catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Engine 2: plain @discordjs/voice (fallback, no ffmpeg needed)      */
/* ------------------------------------------------------------------ */

async function startNativeEngine(guild, channelId) {
  const connection = joinVoiceChannel({
    guildId: guild.id,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const playSilence = () => player.play(createAudioResource(new SilenceStream(), { inputType: StreamType.Opus }));

  let stopped = false;
  player.on('error', (err) => console.error(`[24/7] Player error in "${guild.name}":`, err.message));
  player.on(AudioPlayerStatus.Idle, () => {
    if (!stopped) playSilence(); // the loop: never stay idle
  });
  connection.on('error', (err) => console.error(`[24/7] Connection error in "${guild.name}":`, err.message));

  // Auto-reconnect on disconnect.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (stopped) return;
    try {
      // Moved to another channel / region change: Discord recovers on its own.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECOVERY_WINDOW_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECOVERY_WINDOW_MS),
      ]);
    } catch {
      // Really disconnected (kicked, channel deleted, network): rejoin from scratch.
      scheduleEnsure(guild, 1000);
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
  } catch (err) {
    stopped = true;
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    throw err;
  }

  connection.subscribe(player);
  playSilence();

  return {
    engine: '@discordjs/voice',
    stop: () => {
      stopped = true;
      player.stop(true);
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    },
    alive: () => !stopped && connection.state.status === VoiceConnectionStatus.Ready,
    heal: () => {
      if (!stopped && player.state.status === AudioPlayerStatus.Idle) playSilence();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Session management                                                 */
/* ------------------------------------------------------------------ */

/** Tear down the current voice session of a guild (if any). */
function stopSession(guildId) {
  clearTimeout(timers.get(guildId));
  timers.delete(guildId);
  const session = sessions.get(guildId);
  sessions.delete(guildId);
  try {
    session?.stop();
  } catch (err) {
    console.error('[24/7] Error while stopping a session:', err.message);
  }
  // Make sure no stray connection is left behind.
  const leftover = getVoiceConnection(guildId);
  if (leftover && leftover.state.status !== VoiceConnectionStatus.Destroyed) leftover.destroy();
}

/**
 * Join `channelId` and start the keep-alive audio.
 * Throws if the channel cannot be joined.
 */
async function connect(guild, channelId) {
  if (busy.has(guild.id)) throw new Error('A voice connection attempt is already in progress.');
  busy.add(guild.id);
  try {
    stopSession(guild.id);

    let session;
    if (audioStreamSupported()) {
      try {
        session = await startAudioStreamEngine(guild, channelId);
      } catch (err) {
        console.warn(`[24/7] discord-audio-stream failed in "${guild.name}" (${err.message}). Using the built-in engine.`);
        stopSession(guild.id);
      }
    }
    session ??= await startNativeEngine(guild, channelId);

    sessions.set(guild.id, { channelId, ...session });
    console.log(`[24/7] Connected in "${guild.name}" (engine: ${session.engine}).`);
    return session;
  } finally {
    busy.delete(guild.id);
  }
}

/**
 * Make sure the bot sits in the saved 24/7 channel of this guild.
 * Safe to call as often as you like – it does nothing when all is well.
 */
async function ensure(guild) {
  const saved = db.get('247vc')[guild.id];
  if (!saved?.channelId || busy.has(guild.id)) return;

  const session = sessions.get(guild.id);
  const currentChannelId = guild.members.me?.voice?.channelId ?? null;
  if (session && session.alive() && session.channelId === saved.channelId && currentChannelId === saved.channelId) {
    session.heal?.();
    return; // all good
  }

  // Does the channel still exist?
  let channel;
  try {
    channel = await guild.channels.fetch(saved.channelId);
  } catch (err) {
    if (err.code === 10003) channel = null; // Unknown Channel
    else throw err;
  }
  if (!channel) {
    console.warn(`[24/7] Saved channel in "${guild.name}" no longer exists. Turning 24/7 mode off.`);
    stopSession(guild.id);
    db.update('247vc', (data) => {
      delete data[guild.id];
    });
    return;
  }

  await connect(guild, saved.channelId);
}

/** Run ensure() after a short delay (debounced per guild). */
function scheduleEnsure(guild, delay = RECONNECT_DELAY_MS) {
  if (!db.get('247vc')[guild.id]) return;
  clearTimeout(timers.get(guild.id));
  timers.set(
    guild.id,
    setTimeout(() => {
      timers.delete(guild.id);
      ensure(guild).catch((err) => console.error(`[24/7] Reconnect failed in "${guild.name}":`, err.message));
    }, delay),
  );
}

/** Called on startup and by the watchdog: check every saved guild. */
async function ensureAll(client) {
  for (const guildId of Object.keys(db.get('247vc'))) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue; // bot was removed from that server (entry is kept in case it is re-added)
    try {
      await ensure(guild);
    } catch (err) {
      console.error(`[24/7] Could not (re)join in "${guild.name}":`, err.message);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Slash command                                                      */
/* ------------------------------------------------------------------ */

module.exports = {
  ensure,
  ensureAll,
  scheduleEnsure,

  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('🔊 24/7 voice channel tools.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((group) =>
      group
        .setName('vc')
        .setDescription('Stay in a voice channel 24/7.')
        .addSubcommand((sub) =>
          sub
            .setName('join')
            .setDescription('🔊 Join a voice channel and stay connected 24/7.')
            .addChannelOption((o) =>
              o
                .setName('voice_channel')
                .setDescription('The voice channel to stay in')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) => sub.setName('stop').setDescription('⏹️ Leave the voice channel and turn 24/7 mode off.')),
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();

    /* ---------- /247 vc stop ---------- */
    if (sub === 'stop') {
      const saved = db.get('247vc')[guild.id];
      if (!saved && !sessions.has(guild.id)) {
        return interaction.reply({
          embeds: [embeds.warn(interaction, '24/7 Mode Is Not Active', 'Start it with `/247 vc join`.')],
        });
      }
      // Remove from the DB first so no reconnect logic kicks in.
      db.update('247vc', (data) => {
        delete data[guild.id];
      });
      stopSession(guild.id);
      return interaction.reply({
        embeds: [
          embeds.success(interaction, '24/7 Mode Stopped', 'I left the voice channel and will not rejoin.', {
            fields: saved ? [{ name: '🔈 Channel', value: `<#${saved.channelId}>`, inline: true }] : [],
          }),
        ],
      });
    }

    /* ---------- /247 vc join ---------- */
    const channel = interaction.options.getChannel('voice_channel', true);
    await interaction.reply({ embeds: [embeds.loading(interaction, `Connecting to ${channel.name}...`)] });

    const me = guild.members.me ?? (await guild.members.fetchMe());
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) {
      return interaction.editReply({
        embeds: [embeds.error(interaction, 'Cannot Join That Channel', `I need the **View Channel** and **Connect** permissions in ${channel}.`)],
      });
    }

    const previous = db.get('247vc')[guild.id];
    // Save first, so a crash/restart right now still rejoins this channel.
    db.update('247vc', (data) => {
      data[guild.id] = { channelId: channel.id, setBy: interaction.user.id, since: Date.now() };
    });

    try {
      const session = await connect(guild, channel.id);
      await interaction.editReply({
        embeds: [
          embeds.success(interaction, '24/7 Mode Enabled', `I am now connected to ${channel} and will stay there around the clock.`, {
            fields: [
              { name: '🔈 Channel', value: `${channel}`, inline: true },
              { name: '♻️ Auto-Reconnect', value: 'Enabled', inline: true },
              { name: '🎚️ Audio Engine', value: `\`${session.engine}\``, inline: true },
              { name: '💡 Tip', value: 'Use `/247 vc stop` to make me leave.' },
            ],
          }),
        ],
      });
    } catch (err) {
      console.error('[/247 vc join]', err.message);
      // Roll back to the previous state.
      stopSession(guild.id);
      db.update('247vc', (data) => {
        if (previous) data[guild.id] = previous;
        else delete data[guild.id];
      });
      if (previous) scheduleEnsure(guild, 1000);
      await interaction.editReply({
        embeds: [
          embeds.error(
            interaction,
            'Could Not Connect',
            `I was unable to join ${channel}. Please check my permissions and that the channel is not full, then try again.`,
          ),
        ],
      });
    }
  },
};
