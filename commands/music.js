/**
 * Music system
 * ---------------------------------------------------------------
 * /music play <song name or link>   add a song to the queue
 * /music pause | resume | skip | stop
 * /music queue | nowplaying | shuffle
 * /music loop <off | track | queue>
 *
 * How it works:
 *   yt-dlp  (finds the song + downloads the audio)
 *     -> ffmpeg (converts it to Ogg/Opus)
 *       -> @discordjs/voice (sends it to the voice channel)
 *
 * - yt-dlp is downloaded automatically into ./bin on first use
 *   (official standalone build from GitHub, no Python needed).
 * - ffmpeg comes from the ffmpeg-static package, or from the system
 *   (`sudo apt install ffmpeg`) when that is not available.
 * - Song names are searched on YouTube first, then on SoundCloud.
 *   Direct links work for every site yt-dlp supports.
 *
 * 24/7 mode: when `/247 vc join` is active, music plays in that
 * channel and the bot stays there afterwards.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile, spawnSync } = require('node:child_process');
const {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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
const voice247 = require('./247vc');

const MAX_QUEUE = 100;
const IDLE_LEAVE_MS = 3 * 60_000; // leave the channel 3 minutes after the queue ends
const RESOLVE_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 20_000;
const YTDLP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // re-download weekly (YouTube changes often)

const BIN_DIR = path.join(__dirname, '..', 'bin');
const YTDLP_FILE = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');

/** guildId -> queue */
const queues = new Map();

/* ------------------------------------------------------------------ */
/*  Tools: ffmpeg + yt-dlp                                             */
/* ------------------------------------------------------------------ */

let ffmpegCache;
/** Path of a usable ffmpeg binary, or null. */
function ffmpegPath() {
  if (ffmpegCache !== undefined) return ffmpegCache;
  try {
    const bundled = require('ffmpeg-static');
    if (typeof bundled === 'string' && fs.existsSync(bundled)) return (ffmpegCache = bundled);
  } catch { /* optional dependency not installed */ }
  const system = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return (ffmpegCache = system.status === 0 ? 'ffmpeg' : null);
}

/** Name of the official yt-dlp build for this machine. */
function ytdlpAsset() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (process.arch === 'arm') return 'yt-dlp_linux_armv7l';
  return 'yt-dlp_linux';
}

async function downloadYtDlp() {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`;
  console.log('[Music] Downloading yt-dlp...');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`yt-dlp download failed (HTTP ${res.status})`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const tmp = `${YTDLP_FILE}.download`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  fs.renameSync(tmp, YTDLP_FILE);
  console.log('[Music] yt-dlp is ready.');
}

let ytdlpPromise = null;
let ytdlpExtraArgs = [];
/**
 * Make sure yt-dlp exists and return its path.
 * Order: ./bin/yt-dlp (auto-downloaded, refreshed weekly) -> yt-dlp on the PATH.
 */
function ensureYtDlp() {
  ytdlpPromise ??= (async () => {
    let file = null;
    if (fs.existsSync(YTDLP_FILE)) {
      file = YTDLP_FILE;
      // Old copy: refresh in the background, keep using the current one for now.
      if (Date.now() - fs.statSync(YTDLP_FILE).mtimeMs > YTDLP_MAX_AGE_MS) {
        downloadYtDlp().catch((err) => console.warn('[Music] yt-dlp update failed:', err.message));
      }
    } else {
      try {
        await downloadYtDlp();
        file = YTDLP_FILE;
      } catch (err) {
        console.warn('[Music]', err.message);
        if (spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' }).status === 0) file = 'yt-dlp';
      }
    }
    if (!file) throw new Error('YTDLP_MISSING');

    // Newer yt-dlp versions need a JavaScript runtime for YouTube – we already have Node.js.
    const help = spawnSync(file, ['--help'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    ytdlpExtraArgs = help.stdout?.includes('--js-runtimes') ? ['--js-runtimes', `node:${process.execPath}`] : [];
    // Tell yt-dlp where our ffmpeg is (it needs it for some stream types, e.g. HLS).
    const ffmpeg = ffmpegPath();
    if (ffmpeg && path.isAbsolute(ffmpeg)) ytdlpExtraArgs.push('--ffmpeg-location', ffmpeg);
    // Optional: a cookies.txt next to index.js helps when YouTube blocks the server ("Sign in to confirm...").
    if (fs.existsSync(COOKIES_FILE)) ytdlpExtraArgs.push('--cookies', COOKIES_FILE);
    return file;
  })().catch((err) => {
    ytdlpPromise = null; // allow a retry on the next /music play
    throw err;
  });
  return ytdlpPromise;
}

/** Run yt-dlp and return its stdout. */
function runYtDlp(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, [...ytdlpExtraArgs, ...args], { timeout: RESOLVE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split('\n').pop().slice(0, 300)));
      else resolve(stdout);
    });
  });
}

/** Turn "song name" or a link into a track object. `attempts` overrides where to look. */
async function resolveTrack(query, requestedBy, attempts = null) {
  const file = await ensureYtDlp();
  const base = ['--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download'];
  const isUrl = /^https?:\/\/\S+$/i.test(query);
  // Names: YouTube first, SoundCloud as a backup (YouTube sometimes blocks VPS IPs).
  attempts ??= isUrl ? [query] : [`ytsearch1:${query}`, `scsearch1:${query}`];

  let lastError;
  for (const target of attempts) {
    try {
      let info = JSON.parse(await runYtDlp(file, [...base, target]));
      if (info?._type === 'playlist') info = info.entries?.find(Boolean);
      if (!info) throw new Error('No results found.');
      return {
        title: String(info.title ?? 'Unknown title').slice(0, 200),
        url: info.webpage_url ?? info.original_url ?? info.url,
        duration: Number.isFinite(info.duration) ? Math.round(info.duration) : null,
        thumbnail: typeof info.thumbnail === 'string' && /^https?:\/\//.test(info.thumbnail) ? info.thumbnail : null,
        author: info.uploader ?? info.channel ?? 'Unknown',
        live: Boolean(info.is_live),
        requestedBy,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No results found.');
}

/** Start yt-dlp | ffmpeg for a track and wrap the output as an audio resource. */
function createStream(track, ytdlpFile, volume = 100) {
  const downloader = spawn(
    ytdlpFile,
    [...ytdlpExtraArgs, '-f', 'bestaudio[ext=webm]/bestaudio/best', '-o', '-', '--no-playlist', '--quiet', '--no-warnings', track.url],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const encoder = spawn(
    ffmpegPath(),
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-filter:a', `volume=${(volume / 100).toFixed(2)}`, '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'opus', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  // Keep the last error lines of both programs so failures can be explained.
  const stream = { errorText: '', killed: false };
  for (const [name, child] of [['yt-dlp', downloader], ['ffmpeg', encoder]]) {
    child.stderr.on('data', (chunk) => {
      stream.errorText = `${stream.errorText}[${name}] ${chunk}`.slice(-600);
    });
    child.stderr.on('error', () => {});
  }
  // Broken pipes are normal when a song is skipped – never let them crash the bot.
  for (const emitter of [downloader, encoder, downloader.stdout, encoder.stdin, encoder.stdout]) emitter.on('error', () => {});
  downloader.stdout.pipe(encoder.stdin);

  stream.resource = createAudioResource(encoder.stdout, { inputType: StreamType.OggOpus, metadata: track });
  stream.kill = () => {
    if (stream.killed) return;
    stream.killed = true;
    for (const child of [downloader, encoder]) {
      try {
        child.kill('SIGKILL');
      } catch { /* already gone */ }
    }
  };
  return stream;
}

/* ------------------------------------------------------------------ */
/*  Formatting                                                         */
/* ------------------------------------------------------------------ */

function clock(seconds) {
  if (seconds == null) return 'LIVE';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const link = (track) => `[${track.title.replace(/[[\]]/g, '')}](${track.url})`;
const LOOP_LABEL = { off: 'Off', track: '🔂 Track', queue: '🔁 Queue' };
const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

function controls(queue) {
  const paused = queue.player.state.status === AudioPlayerStatus.Paused;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_pause').setEmoji(paused ? '▶️' : '⏸️').setLabel(paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setLabel('Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_loop').setEmoji('🔁').setLabel(`Loop: ${queue.loop}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_queue').setEmoji('📜').setLabel('Queue').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setLabel('Stop').setStyle(ButtonStyle.Danger),
  );
}

function nowPlayingEmbed(ctx, queue, withProgress = false) {
  const track = queue.current;
  const played = Math.floor((queue.stream?.resource?.playbackDuration ?? 0) / 1000);
  const fields = [
    { name: '🎤 Artist / Channel', value: track.author.slice(0, 100), inline: true },
    { name: '⏱️ Length', value: clock(track.duration), inline: true },
    { name: '🙋 Requested by', value: `<@${track.requestedBy}>`, inline: true },
    { name: '🔁 Loop', value: LOOP_LABEL[queue.loop], inline: true },
    { name: '📜 Up next', value: queue.tracks.length ? `${queue.tracks.length} song${queue.tracks.length === 1 ? '' : 's'}` : 'Nothing', inline: true },
  ];
  if (withProgress && track.duration) {
    fields.push({ name: '📍 Progress', value: `\`${clock(played)}\` \`${embeds.bar(played, track.duration, 16)}\` \`${clock(track.duration)}\`` });
  }
  return embeds.make(ctx, {
    color: embeds.COLORS.cyan,
    title: `${embeds.e('bow')} Now Playing`,
    description: `### 🎶 ${link(track)}`,
    fields,
    thumbnail: track.thumbnail ?? undefined,
  });
}

function queueEmbed(ctx, queue) {
  const lines = queue.tracks.slice(0, 10).map((t, i) => `**${i + 1}.** ${link(t)} \`${clock(t.duration)}\` • <@${t.requestedBy}>`);
  const total = queue.tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  return embeds.make(ctx, {
    color: embeds.COLORS.purple,
    title: '📜 Music Queue',
    description:
      `**Now playing:** ${queue.current ? `${link(queue.current)} \`${clock(queue.current.duration)}\`` : '*Nothing*'}\n\n` +
      (lines.length ? lines.join('\n') : '*The queue is empty. Add songs with `/music play`.*') +
      (queue.tracks.length > 10 ? `\n*…and ${queue.tracks.length - 10} more*` : ''),
    fields: [
      { name: '🎵 Songs waiting', value: `${queue.tracks.length}`, inline: true },
      { name: '⏱️ Total length', value: clock(total), inline: true },
      { name: '🔁 Loop', value: LOOP_LABEL[queue.loop], inline: true },
    ],
  });
}

/** Post a status embed in the channel where music was requested. */
function announce(queue, payload) {
  return queue.textChannel?.send(payload).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Queue / playback                                                   */
/* ------------------------------------------------------------------ */

/** Stop everything for a guild. `connectionGone` = the voice connection was already destroyed. */
function destroyQueue(queue, { connectionGone = false } = {}) {
  if (queue.destroyed) return;
  queue.destroyed = true;
  queues.delete(queue.guildId);
  clearTimeout(queue.idleTimer);
  queue.tracks = [];
  queue.current = null;
  queue.stream?.kill();
  queue.player.stop(true);
  if (connectionGone) return;
  if (queue.ownConnection) {
    if (queue.connection.state.status !== VoiceConnectionStatus.Destroyed) queue.connection.destroy();
  } else {
    voice247.resumeSilence(queue.guildId); // 24/7 mode: stay in the channel, back to silence
  }
}

/** Play the next song of the queue (or finish). */
async function playNext(queue) {
  if (queue.destroyed) return;
  queue.stream?.kill();
  queue.stream = null;

  const previous = queue.current;
  if (previous && !queue.skipRequested) {
    if (queue.loop === 'track') queue.tracks.unshift(previous);
    else if (queue.loop === 'queue') queue.tracks.push(previous);
  }
  queue.skipRequested = false;
  queue.current = queue.tracks.shift() ?? null;

  // Queue finished.
  if (!queue.current) {
    announce(queue, { embeds: [embeds.info(queue.client, '🎵 Queue Finished', 'Add more songs with `/music play`.', { color: embeds.COLORS.purple })] });
    if (queue.ownConnection) {
      queue.idleTimer = setTimeout(() => destroyQueue(queue), IDLE_LEAVE_MS);
    } else {
      voice247.resumeSilence(queue.guildId);
    }
    return;
  }

  try {
    const stream = createStream(queue.current, await ensureYtDlp(), queue.volume);
    queue.stream = stream;
    queue.player.play(stream.resource);
    announce(queue, { embeds: [nowPlayingEmbed(queue.client, queue)], components: [controls(queue)] });
  } catch (err) {
    console.error('[Music] Could not start a song:', err.message);
    announce(queue, { embeds: [embeds.error(queue.client, 'Could Not Play Song', `Skipping **${queue.current.title}**.`)] });
    queue.skipRequested = true;
    setImmediate(() => playNext(queue));
  }
}

/** Short, readable reason for a failed download (last meaningful line of the tool output). */
function shortReason(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // yt-dlp reports the real cause as "ERROR: ..."; ffmpeg errors are only a consequence of it.
  const line =
    lines.find((l) => /^(\[yt-dlp\] )?ERROR:/.test(l)) ?? [...lines].reverse().find((l) => /error/i.test(l)) ?? lines[0] ?? 'no audio received';
  return line.replace(/```/g, '').slice(0, 250);
}

/**
 * A song could not be downloaded (most often: YouTube blocks the server's IP).
 * Look the same title up on SoundCloud and put that at the front of the queue.
 */
async function recoverTrack(queue, failed, reason) {
  const fromSoundCloud = /soundcloud\.com/i.test(failed.url);
  if (!failed.isFallback && !fromSoundCloud && !queue.destroyed) {
    try {
      const cleanTitle = failed.title.replace(/#\S+/g, ' ').replace(/\s+/g, ' ').trim();
      const alternative = await resolveTrack(cleanTitle, failed.requestedBy, [`scsearch1:${cleanTitle}`]);
      alternative.isFallback = true;
      if (queue.destroyed) return;
      queue.tracks.unshift(alternative);
      announce(queue, {
        embeds: [
          embeds.warn(queue.client, 'Source Blocked, Trying SoundCloud', `**${failed.title}** could not be loaded from its original site.\nPlaying the closest SoundCloud match instead: ${link(alternative)}`, {
            fields: [{ name: '🧾 Reason', value: `\`\`\`${shortReason(reason)}\`\`\`` }],
          }),
        ],
      });
      return;
    } catch (err) {
      console.error('[Music] SoundCloud fallback failed:', err.message);
    }
  }
  if (queue.destroyed) return;
  announce(queue, {
    embeds: [
      embeds.error(queue.client, 'Could Not Play Song', `**${failed.title}** could not be loaded, so I skipped it.`, {
        fields: [{ name: '🧾 Reason', value: `\`\`\`${shortReason(reason)}\`\`\`` }],
      }),
    ],
  });
}

/** Create the queue + player for a guild on top of a voice connection. */
function createQueue(interaction, connection, ownConnection) {
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const queue = {
    client: interaction.client,
    guildId: interaction.guildId,
    textChannel: interaction.channel,
    connection,
    ownConnection,
    player,
    tracks: [],
    current: null,
    stream: null,
    loop: 'off',
    volume: 100,
    skipRequested: false,
    destroyed: false,
    idleTimer: null,
  };

  player.on('error', (err) => console.error('[Music] Player error:', err.message));
  player.on(AudioPlayerStatus.Idle, () => {
    // A song that ends almost instantly means the download failed.
    const stream = queue.stream;
    if (stream && !stream.killed && !queue.skipRequested && stream.resource.playbackDuration < 1500 && queue.current) {
      const failed = queue.current;
      const reason = stream.errorText.trim() || 'no audio received';
      console.error(`[Music] "${failed.title}" failed:`, reason);
      queue.skipRequested = true; // do not loop a broken song forever
      // Try the same song from SoundCloud before giving up, then continue with the queue.
      recoverTrack(queue, failed, reason)
        .catch((err) => console.error('[Music] recovery failed:', err.message))
        .finally(() => playNext(queue).catch((err) => console.error('[Music] playNext failed:', err.message)));
      return;
    }
    playNext(queue).catch((err) => console.error('[Music] playNext failed:', err.message));
  });

  // If the voice connection disappears (kicked, /247 vc stop, reconnect), stop the music cleanly.
  connection.on('stateChange', (_old, now) => {
    if (now.status === VoiceConnectionStatus.Destroyed) destroyQueue(queue, { connectionGone: true });
  });
  if (ownConnection) {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        destroyQueue(queue); // really disconnected
      }
    });
  }

  connection.subscribe(player);
  queues.set(queue.guildId, queue);
  return queue;
}

/** Get (or open) the voice connection music should use. Returns { connection, own } or throws a user-facing Error. */
async function acquireConnection(interaction, voiceChannel) {
  const { guild } = interaction;
  const pinned = voice247.savedChannelId(guild.id);

  if (pinned) {
    // 24/7 mode owns the connection; music is played on top of it.
    if (voiceChannel.id !== pinned) throw new Error(`24/7 mode is active. Please join <#${pinned}> to play music.`);
    await voice247.ensure(guild).catch(() => {});
    const connection = getVoiceConnection(guild.id);
    if (!connection) throw new Error('I could not connect to the 24/7 voice channel. Please try again in a moment.');
    return { connection, own: false };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!voiceChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error(`I need the **View Channel**, **Connect** and **Speak** permissions in ${voiceChannel}.`);
  }

  const connection = joinVoiceChannel({ guildId: guild.id, channelId: voiceChannel.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
  } catch {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    throw new Error(`I could not join ${voiceChannel}. Please check my permissions and try again.`);
  }
  return { connection, own: true };
}

/**
 * Checks shared by every control (command or button).
 * Returns the queue, or replies with an error embed and returns null.
 */
async function requireQueue(interaction, { needSong = true } = {}) {
  const queue = queues.get(interaction.guildId);
  if (!queue || (needSong && !queue.current)) {
    await interaction.reply(ephemeral(embeds.error(interaction, 'Nothing Is Playing', 'Start the music with `/music play`.')));
    return null;
  }
  const botChannel = interaction.guild.members.me?.voice?.channelId;
  if (botChannel && interaction.member?.voice?.channelId !== botChannel) {
    await interaction.reply(ephemeral(embeds.error(interaction, 'Join My Voice Channel', `You have to be in <#${botChannel}> to control the music.`)));
    return null;
  }
  return queue;
}

/* ------------------------------------------------------------------ */
/*  Actions (shared by slash commands and buttons)                     */
/* ------------------------------------------------------------------ */

const actions = {
  async pause(interaction, queue) {
    if (queue.player.state.status === AudioPlayerStatus.Paused) return actions.resume(interaction, queue);
    queue.player.pause();
    return interaction.reply({ embeds: [embeds.info(interaction, '⏸️ Paused', `Paused ${link(queue.current)}.`, { color: embeds.COLORS.gold })] });
  },
  async resume(interaction, queue) {
    queue.player.unpause();
    return interaction.reply({ embeds: [embeds.success(interaction, 'Resumed', `Playing ${link(queue.current)} again.`)] });
  },
  async skip(interaction, queue) {
    const skipped = queue.current;
    queue.skipRequested = true;
    queue.player.unpause();
    queue.player.stop(true); // -> Idle -> playNext()
    return interaction.reply({ embeds: [embeds.success(interaction, 'Skipped', `Skipped ${link(skipped)}.`)] });
  },
  async stop(interaction, queue) {
    destroyQueue(queue);
    return interaction.reply({ embeds: [embeds.success(interaction, 'Music Stopped', 'The queue was cleared.')] });
  },
  async loop(interaction, queue, mode) {
    const order = ['off', 'track', 'queue'];
    queue.loop = mode ?? order[(order.indexOf(queue.loop) + 1) % order.length];
    return interaction.reply({ embeds: [embeds.success(interaction, 'Loop Mode Changed', `Loop is now: **${LOOP_LABEL[queue.loop]}**`)] });
  },
  async queue(interaction, queue) {
    return interaction.reply(ephemeral(queueEmbed(interaction, queue)));
  },
};

/** Router for the "music_*" buttons (called from events/interactionCreate.js). */
async function handleButton(interaction) {
  const action = interaction.customId.slice('music_'.length);
  if (!actions[action]) return;
  const queue = await requireQueue(interaction);
  if (queue) await actions[action](interaction, queue);
}

/* ------------------------------------------------------------------ */
/*  Slash command                                                      */
/* ------------------------------------------------------------------ */

module.exports = {
  handleButton,

  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('🎵 Music player.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('▶️ Play a song (name or link) or add it to the queue.')
        .addStringOption((o) => o.setName('song').setDescription('Song name or a link (YouTube, SoundCloud, ...)').setRequired(true).setMaxLength(300)),
    )
    .addSubcommand((sub) => sub.setName('pause').setDescription('⏸️ Pause the music.'))
    .addSubcommand((sub) => sub.setName('resume').setDescription('▶️ Resume the music.'))
    .addSubcommand((sub) => sub.setName('skip').setDescription('⏭️ Skip the current song.'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('⏹️ Stop the music and clear the queue.'))
    .addSubcommand((sub) => sub.setName('queue').setDescription('📜 Show the queue.'))
    .addSubcommand((sub) => sub.setName('nowplaying').setDescription('🎶 Show the current song.'))
    .addSubcommand((sub) => sub.setName('shuffle').setDescription('🔀 Shuffle the queue.'))
    .addSubcommand((sub) =>
      sub
        .setName('loop')
        .setDescription('🔁 Repeat the current song or the whole queue.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('What to repeat')
            .setRequired(true)
            .addChoices({ name: 'Off', value: 'off' }, { name: 'Current song', value: 'track' }, { name: 'Whole queue', value: 'queue' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('volume')
        .setDescription('🔊 Change the volume (applies from the next song).')
        .addIntegerOption((o) => o.setName('percent').setDescription('10 to 200 (100 = normal)').setRequired(true).setMinValue(10).setMaxValue(200)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'volume') {
      const queue = await requireQueue(interaction, { needSong: false });
      if (!queue) return undefined;
      queue.volume = interaction.options.getInteger('percent', true);
      return interaction.reply({ embeds: [embeds.success(interaction, 'Volume Changed', `Volume is now **${queue.volume}%**. It applies from the **next song** (use \`/music skip\` to hear it now).`)] });
    }

    /* ---------- simple controls ---------- */
    if (sub !== 'play') {
      const queue = await requireQueue(interaction);
      if (!queue) return undefined;

      if (sub === 'nowplaying') {
        return interaction.reply({ embeds: [nowPlayingEmbed(interaction, queue, true)], components: [controls(queue)] });
      }
      if (sub === 'shuffle') {
        for (let i = queue.tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
        return interaction.reply({ embeds: [embeds.success(interaction, 'Queue Shuffled', `Shuffled **${queue.tracks.length}** song${queue.tracks.length === 1 ? '' : 's'}.`)] });
      }
      if (sub === 'loop') return actions.loop(interaction, queue, interaction.options.getString('mode', true));
      return actions[sub](interaction, queue);
    }

    /* ---------- /music play ---------- */
    const query = interaction.options.getString('song', true).trim();
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Join a Voice Channel', 'You have to be in a voice channel to play music.')));
    }

    let queue = queues.get(interaction.guildId);
    const botChannel = interaction.guild.members.me?.voice?.channelId;
    if (queue && botChannel && botChannel !== voiceChannel.id) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Already Playing Elsewhere', `I am playing music in <#${botChannel}>. Join that channel to add songs.`)));
    }
    if (queue && queue.tracks.length >= MAX_QUEUE) {
      return interaction.reply(ephemeral(embeds.error(interaction, 'Queue Is Full', `The queue can hold up to **${MAX_QUEUE}** songs.`)));
    }
    if (!ffmpegPath()) {
      return interaction.reply(
        ephemeral(embeds.error(interaction, 'FFmpeg Is Missing', 'Music needs FFmpeg on the server.\nLinux: `sudo apt install -y ffmpeg`, then `pm2 restart DiscordBot`.')),
      );
    }

    await interaction.reply({ embeds: [embeds.loading(interaction, `Searching for "${query.slice(0, 60)}"...`)] });

    // 1. Find the song.
    let track;
    try {
      track = await resolveTrack(query, interaction.user.id);
    } catch (err) {
      console.error('[/music play] resolve failed:', err.message);
      const text =
        err.message === 'YTDLP_MISSING'
          ? 'The music downloader (yt-dlp) could not be installed automatically. Check the internet connection of the server and try again.'
          : /sign in|not a bot|429|403/i.test(err.message)
            ? 'YouTube is blocking this server right now. Try a **SoundCloud link** or a different song name.'
            : `I could not find or load that song.\n\`\`\`${err.message.slice(0, 200)}\`\`\``;
      return interaction.editReply({ embeds: [embeds.error(interaction, 'Song Not Found', text)] });
    }

    // 2. Connect (or reuse the current queue).
    queue = queues.get(interaction.guildId);
    if (!queue) {
      try {
        const { connection, own } = await acquireConnection(interaction, voiceChannel);
        // Someone else may have started a queue while we were connecting.
        queue = queues.get(interaction.guildId) ?? createQueue(interaction, connection, own);
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error(interaction, 'Could Not Connect', err.message)] });
      }
    }
    clearTimeout(queue.idleTimer);
    queue.textChannel = interaction.channel ?? queue.textChannel;

    // 3. Queue it, and start playing if nothing is running.
    queue.tracks.push(track);
    const startsNow = !queue.current;
    await interaction.editReply({
      embeds: [
        embeds.success(interaction, startsNow ? 'Starting Playback' : 'Added to Queue', `### 🎶 ${link(track)}`, {
          fields: [
            { name: '🎤 Artist / Channel', value: track.author.slice(0, 100), inline: true },
            { name: '⏱️ Length', value: clock(track.duration), inline: true },
            { name: '📍 Position', value: startsNow ? 'Now' : `#${queue.tracks.length}`, inline: true },
          ],
          thumbnail: track.thumbnail ?? undefined,
        }),
      ],
    });
    if (startsNow) await playNext(queue);
    return undefined;
  },
};
