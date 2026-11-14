/**
 * utils/cards.js
 * ---------------------------------------------------------------
 * Image cards (PNG) drawn with @napi-rs/canvas:
 *   pingCard({ botName, avatarUrl, gateway, response, uptime, servers })
 *   rankCard({ username, avatarUrl, level, rank, xp, needed, totalXp })
 *
 * Each function returns a PNG Buffer, or null when images are not
 * available on this machine (the canvas package is optional). Callers
 * then fall back to their normal embed, so nothing ever breaks.
 *
 * The Inter font is bundled in assets/fonts, because a fresh VPS often
 * has no fonts installed at all (text would be invisible otherwise).
 * ---------------------------------------------------------------
 */
const path = require('node:path');

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
  const fonts = path.join(__dirname, '..', 'assets', 'fonts');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_400Regular.ttf'), 'Inter');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_600SemiBold.ttf'), 'Inter SemiBold');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_800ExtraBold.ttf'), 'Inter ExtraBold');
} catch (err) {
  console.warn('[Cards] Image cards are disabled (', err.message.split('\n')[0], '). Run "npm install" to enable them.');
}

const W = 900;
const H = 360;
const FONT = { regular: 'Inter', semi: 'Inter SemiBold', bold: 'Inter ExtraBold' };
const AVATAR_TIMEOUT_MS = 4000;

const available = () => Boolean(canvasLib);

/* ------------------------------ helpers ------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Soft coloured light in the background. */
function glow(ctx, x, y, radius, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** Dark gradient background with two glows, a glass panel and a thin border. */
function background(ctx, accent) {
  roundRect(ctx, 0, 0, W, H, 36);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1023');
  bg.addColorStop(0.55, '#141233');
  bg.addColorStop(1, '#1d1145');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  glow(ctx, 120, 40, 360, 'rgba(88,101,242,0.45)');
  glow(ctx, W - 80, H - 20, 380, `${accent}55`);
  glow(ctx, W * 0.55, -60, 260, 'rgba(0,229,255,0.18)');

  // faint dot grid
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let x = 24; x < W; x += 28) for (let y = 24; y < H; y += 28) ctx.fillRect(x, y, 2, 2);

  // glass panel
  roundRect(ctx, 22, 22, W - 44, H - 44, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();
}

/** Download an avatar; null when it cannot be loaded in time. */
async function loadAvatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await canvasLib.loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Round avatar with a gradient ring. Falls back to the first letter of `name`. */
function drawAvatar(ctx, image, name, cx, cy, radius, accent) {
  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, '#5865f2');
  ring.addColorStop(1, accent);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = '#23264a';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(radius * 0.95)}px "${FONT.bold}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((clean(name).replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase(), cx, cy + radius * 0.04);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Keep only characters the bundled font can draw (Latin, Greek, Cyrillic, digits, common
 * punctuation). Emojis and other scripts would show up as empty boxes.
 */
const clean = (value) =>
  String(value)
    .replace(/[^\u0020-\u007E\u00A1-\u024F\u0370-\u03FF\u0400-\u04FF\u2010-\u2027\u20AC\u20B9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Text that is cut with "…" when it is wider than maxWidth. Emojis/symbols the font cannot draw are removed. */
function fitText(ctx, value, maxWidth) {
  let out = clean(value) || 'User';
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Rounded progress bar with a gradient fill. */
function progressBar(ctx, x, y, w, h, ratio, from, to) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  const filled = Math.max(h, w * Math.min(1, Math.max(0, ratio)));
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  roundRect(ctx, x, y, filled, h, h / 2);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Small stat tile: label on top, value below. */
function tile(ctx, x, y, w, h, label, value, accent) {
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = 'rgba(8,10,28,0.55)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.stroke();
  roundRect(ctx, x + 14, y + 16, 4, h - 32, 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `15px "${FONT.semi}"`;
  ctx.fillText(label.toUpperCase(), x + 30, y + 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = `24px "${FONT.bold}"`;
  ctx.fillText(fitText(ctx, value, w - 44), x + 30, y + h - 18);
}

function uptimeText(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/** Connection quality for a latency in ms. */
function quality(ms) {
  if (!(ms >= 0)) return { label: 'MEASURING', color: '#9aa4c7', bars: 0 };
  if (ms < 100) return { label: 'EXCELLENT', color: '#2ee59d', bars: 4 };
  if (ms < 200) return { label: 'GOOD', color: '#00e5ff', bars: 3 };
  if (ms < 400) return { label: 'AVERAGE', color: '#ffc94d', bars: 2 };
  return { label: 'SLOW', color: '#ff4d6d', bars: 1 };
}

/* ------------------------------ ping card ------------------------------ */

/**
 * @param {{ botName: string, avatarUrl?: string, gateway: number, response: number, uptime: number, servers: number }} data
 * @returns {Promise<Buffer|null>}
 */
async function pingCard(data) {
  if (!canvasLib) return null;
  const q = quality(data.gateway >= 0 ? data.gateway : data.response);
  const canvas = canvasLib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  background(ctx, q.color);

  // left: avatar + name
  drawAvatar(ctx, await loadAvatar(data.avatarUrl), data.botName, 112, 112, 52, q.color);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `17px "${FONT.semi}"`;
  ctx.fillText('P O N G', 190, 92);
  ctx.fillStyle = '#ffffff';
  ctx.font = `34px "${FONT.bold}"`;
  ctx.fillText(fitText(ctx, data.botName, 300), 190, 132);

  // big latency number
  const shown = data.gateway >= 0 ? Math.round(data.gateway) : Math.round(data.response);
  const number = ctx.createLinearGradient(60, 180, 360, 290);
  number.addColorStop(0, '#ffffff');
  number.addColorStop(1, q.color);
  ctx.fillStyle = number;
  ctx.font = `104px "${FONT.bold}"`;
  ctx.fillText(`${shown}`, 60, 286);
  const numberWidth = ctx.measureText(`${shown}`).width;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `34px "${FONT.semi}"`;
  ctx.fillText('ms', 72 + numberWidth, 286);

  // quality pill
  ctx.font = `16px "${FONT.bold}"`;
  const pillWidth = ctx.measureText(q.label).width + 44;
  const pillX = 72 + numberWidth + 62;
  roundRect(ctx, pillX, 252, pillWidth, 34, 17);
  ctx.fillStyle = `${q.color}2e`;
  ctx.fill();
  ctx.strokeStyle = q.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pillX + 17, 269, 5, 0, Math.PI * 2);
  ctx.fillStyle = q.color;
  ctx.fill();
  ctx.fillText(q.label, pillX + 30, 275);

  // latency bar (0 - 500 ms, fuller = faster)
  progressBar(ctx, 60, 306, 440, 10, 1 - Math.min(shown, 500) / 500, '#5865f2', q.color);

  // signal bars (top right)
  for (let i = 0; i < 4; i++) {
    const h = 14 + i * 10;
    roundRect(ctx, W - 118 + i * 18, 96 - h, 11, h, 4);
    ctx.fillStyle = i < q.bars ? q.color : 'rgba(255,255,255,0.16)';
    ctx.fill();
  }

  // right: tiles
  const x = 548;
  tile(ctx, x, 118, 150, 78, 'Gateway', data.gateway >= 0 ? `${Math.round(data.gateway)} ms` : '—', '#5865f2');
  tile(ctx, x + 164, 118, 150, 78, 'Response', `${Math.round(data.response)} ms`, '#00e5ff');
  tile(ctx, x, 210, 150, 78, 'Uptime', uptimeText(data.uptime), '#2ee59d');
  tile(ctx, x + 164, 210, 150, 78, 'Servers', `${data.servers}`, '#ffc94d');

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `14px "${FONT.regular}"`;
  ctx.textAlign = 'right';
  ctx.fillText(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, x + 314, 316);
  ctx.textAlign = 'left';

  return canvas.encode('png');
}

/* ------------------------------ rank card ------------------------------ */

/**
 * @param {{ username: string, avatarUrl?: string, level: number, rank: number|null, xp: number, needed: number, totalXp: number }} data
 * @returns {Promise<Buffer|null>}
 */
async function rankCard(data) {
  if (!canvasLib) return null;
  const accent = '#00e5ff';
  const canvas = canvasLib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  background(ctx, accent);

  drawAvatar(ctx, await loadAvatar(data.avatarUrl), data.username, 150, 180, 92, accent);

  const left = 290;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `17px "${FONT.semi}"`;
  ctx.fillText('R A N K   C A R D', left, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = `44px "${FONT.bold}"`;
  ctx.fillText(fitText(ctx, data.username, 330), left, 148);

  // level + rank (right)
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `16px "${FONT.semi}"`;
  ctx.fillText('LEVEL', W - 60, 92);
  const lvl = ctx.createLinearGradient(W - 200, 100, W - 60, 160);
  lvl.addColorStop(0, '#ffffff');
  lvl.addColorStop(1, accent);
  ctx.fillStyle = lvl;
  ctx.font = `64px "${FONT.bold}"`;
  ctx.fillText(`${data.level}`, W - 60, 152);
  ctx.textAlign = 'left';

  // tiles
  tile(ctx, left, 172, 170, 74, 'Server rank', data.rank ? `#${data.rank}` : 'Unranked', '#ffc94d');
  tile(ctx, left + 184, 172, 170, 74, 'Total XP', data.totalXp.toLocaleString('en-IN'), '#2ee59d');
  tile(ctx, left + 368, 172, 182, 74, 'Next level', `${Math.max(0, data.needed - data.xp).toLocaleString('en-IN')} XP`, '#9b5cff');

  // progress
  progressBar(ctx, left, 272, 550, 22, data.needed ? data.xp / data.needed : 0, '#5865f2', accent);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `16px "${FONT.semi}"`;
  ctx.fillText(`${data.xp.toLocaleString('en-IN')} / ${data.needed.toLocaleString('en-IN')} XP`, left, 320);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.floor((data.needed ? data.xp / data.needed : 0) * 100)}%`, left + 550, 320);
  ctx.textAlign = 'left';

  return canvas.encode('png');
}

module.exports = { available, pingCard, rankCard, quality };
