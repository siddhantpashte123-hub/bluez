/**
 * utils/cards.js
 * ---------------------------------------------------------------
 * Image cards (PNG) drawn with @napi-rs/canvas:
 *   pingCard({ botName, avatarUrl, gateway, response, uptime, servers })
 *   rankCard({ username, avatarUrl, level, rank, xp, needed, totalXp })
 *   botInfoCard(), ltcPriceCard(), coinFlipCard()
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
const { wrapPreservingText } = require('./text-layout');

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
  const fonts = path.join(__dirname, '..', 'assets', 'fonts');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_400Regular.ttf'), 'Inter');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_600SemiBold.ttf'), 'Inter SemiBold');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'Inter_800ExtraBold.ttf'), 'Inter ExtraBold');
  canvasLib.GlobalFonts.registerFromPath(path.join(fonts, 'NotoSansDevanagari.ttf'), 'Noto Sans Devanagari');
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
  background(ctx, data.accent ?? q.color);

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
  const accent = data.accent ?? '#00e5ff';
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

/** Shared premium cards; callers retain embed fallbacks if canvas is unavailable. */
async function welcomeCard({ username, avatarUrl, server, count, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  drawAvatar(ctx, await loadAvatar(avatarUrl), username, 150, 180, 88, accent);
  ctx.fillStyle = '#9caee4'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText('A NEW MEMBER HAS ARRIVED', 285, 100);
  ctx.fillStyle = '#ffffff'; ctx.font = `45px "${FONT.bold}"`; ctx.fillText(fitText(ctx, username, 545), 285, 155);
  ctx.fillStyle = '#d4d8f5'; ctx.font = `24px "${FONT.regular}"`; ctx.fillText(`Welcome to ${fitText(ctx, server, 405)}`, 285, 200);
  tile(ctx, 285, 230, 250, 74, 'Member', `#${count}`, '#00e5ff');
  return canvas.encode('png');
}

async function leaderboardCard({ server, entries, accent = '#ffc94d' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  ctx.fillStyle = '#ffffff'; ctx.font = `30px "${FONT.bold}"`; ctx.fillText('LEVEL LEADERBOARD', 55, 75);
  ctx.fillStyle = '#b4c0e5'; ctx.font = `16px "${FONT.semi}"`; ctx.fillText(fitText(ctx, server, 280), 55, 101);
  entries.slice(0, 10).forEach((entry, i) => {
    const x = i < 5 ? 55 : 460, y = 135 + (i % 5) * 40;
    ctx.fillStyle = i < 3 ? '#ffc94d' : '#98a8db'; ctx.font = `17px "${FONT.bold}"`; ctx.fillText(`#${i + 1}`, x, y);
    ctx.fillStyle = '#ffffff'; ctx.font = `16px "${FONT.semi}"`; ctx.fillText(fitText(ctx, entry.name, 195), x + 42, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#b4c0e5'; ctx.fillText(`${Number(entry.xp).toLocaleString('en-IN')} XP`, x + 365, y); ctx.textAlign = 'left';
  });
  return canvas.encode('png');
}

async function profileCard({ username, avatarUrl, joined, roleCount, level, accent = '#9b5cff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  drawAvatar(ctx, await loadAvatar(avatarUrl), username, 145, 175, 85, accent);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText('MEMBER PROFILE', 280, 95);
  ctx.fillStyle = '#ffffff'; ctx.font = `40px "${FONT.bold}"`; ctx.fillText(fitText(ctx, username, 550), 280, 150);
  tile(ctx, 280, 192, 175, 78, 'Joined', joined || 'Unknown', '#00e5ff');
  tile(ctx, 470, 192, 165, 78, 'Roles', `${roleCount}`, '#ffc94d');
  tile(ctx, 650, 192, 185, 78, 'Level', `${level}`, '#9b5cff');
  return canvas.encode('png');
}

async function orderCard({ number, product, price, status, buyer, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText('ORDER RECEIPT', 60, 85);
  ctx.fillStyle = '#ffffff'; ctx.font = `38px "${FONT.bold}"`; ctx.fillText(fitText(ctx, product, 610), 60, 135);
  ctx.fillStyle = '#9caee4'; ctx.font = `18px "${FONT.semi}"`; ctx.fillText(`Order #${number}  •  ${fitText(ctx, buyer, 420)}`, 60, 174);
  tile(ctx, 60, 210, 350, 78, 'Amount', price, '#00e5ff');
  tile(ctx, 430, 210, 350, 78, 'Status', status, '#ffc94d');
  return canvas.encode('png');
}

async function serverCard({ name, iconUrl, members, boosts, channels, created, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  drawAvatar(ctx, await loadAvatar(iconUrl), name, 130, 135, 70, accent);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText('SERVER OVERVIEW', 245, 93);
  ctx.fillStyle = '#fff'; ctx.font = `36px "${FONT.bold}"`; ctx.fillText(fitText(ctx, name, 580), 245, 145);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText(`CREATED ${created}`, 245, 178);
  tile(ctx, 55, 220, 245, 78, 'Members', `${members}`, accent);
  tile(ctx, 325, 220, 245, 78, 'Boosts', `${boosts}`, '#ffc94d');
  tile(ctx, 595, 220, 245, 78, 'Channels', `${channels}`, '#9b5cff');
  return canvas.encode('png');
}

async function levelUpCard({ username, avatarUrl, level, server, accent = '#ffc94d' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  drawAvatar(ctx, await loadAvatar(avatarUrl), username, 150, 180, 85, accent);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `18px "${FONT.semi}"`; ctx.fillText('LEVEL UP', 285, 105);
  ctx.fillStyle = '#fff'; ctx.font = `42px "${FONT.bold}"`; ctx.fillText(fitText(ctx, username, 520), 285, 157);
  ctx.fillStyle = '#d4d8f5'; ctx.font = `22px "${FONT.regular}"`; ctx.fillText(`Reached level ${level} in ${fitText(ctx, server, 310)}`, 285, 205);
  tile(ctx, 285, 235, 215, 70, 'New level', `${level}`, accent);
  return canvas.encode('png');
}

/** Bot information: avatar and six live runtime statistics. */
async function botInfoCard({ botName, avatarUrl, servers, commands, uptime, memory, nodeVersion, discordVersion, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  drawAvatar(ctx, await loadAvatar(avatarUrl), botName, 98, 94, 43, accent);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('B O T   O V E R V I E W', 165, 78);
  ctx.fillStyle = '#ffffff'; ctx.font = `30px "${FONT.bold}"`; ctx.fillText(fitText(ctx, botName, 435), 165, 118);
  ctx.fillStyle = '#aeb9e5'; ctx.font = `14px "${FONT.semi}"`; ctx.textAlign = 'right'; ctx.fillText('SYSTEM STATUS', 839, 80); ctx.textAlign = 'left';
  tile(ctx, 55, 154, 245, 70, 'Servers', String(servers), accent);
  tile(ctx, 325, 154, 245, 70, 'Commands', String(commands), '#9b5cff');
  tile(ctx, 595, 154, 245, 70, 'Uptime', uptime, '#2ee59d');
  tile(ctx, 55, 240, 245, 70, 'Memory', memory, '#ffc94d');
  tile(ctx, 325, 240, 245, 70, 'Node.js', nodeVersion, accent);
  tile(ctx, 595, 240, 245, 70, 'Discord.js', discordVersion, '#9b5cff');
  return canvas.encode('png');
}

/** Rates come from the existing price provider, which caches them for up to one minute. */
async function ltcPriceCard({ inr, usd, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  const coin = ctx.createLinearGradient(50, 70, 220, 280);
  coin.addColorStop(0, '#ffffff'); coin.addColorStop(0.45, '#c2d4e8'); coin.addColorStop(1, '#6284b4');
  ctx.beginPath(); ctx.arc(145, 174, 89, 0, Math.PI * 2); ctx.fillStyle = coin; ctx.fill();
  ctx.beginPath(); ctx.arc(145, 174, 76, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
  ctx.fillStyle = '#273d63'; ctx.font = `100px "${FONT.bold}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Ł', 145, 179); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#aeb9e5'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('MARKET PRICE  /  1 LTC', 280, 95);
  ctx.fillStyle = '#ffffff'; ctx.font = `38px "${FONT.bold}"`; ctx.fillText('Litecoin', 280, 142);
  ctx.fillStyle = '#9ba9d2'; ctx.font = `16px "${FONT.regular}"`; ctx.fillText('Price in your preferred currency', 280, 172);
  tile(ctx, 280, 200, 255, 78, 'INR', inr, accent);
  tile(ctx, 555, 200, 255, 78, 'USD', usd, '#9b5cff');
  ctx.fillStyle = '#aeb9e5'; ctx.font = `13px "${FONT.regular}"`; ctx.fillText('Rates may be cached for up to 60 seconds.', 280, 311);
  return canvas.encode('png');
}

/** Coin artwork reflects the exact result chosen by the command, not a second flip. */
async function coinFlipCard({ result, username, accent = '#ffc94d' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);

  // Polished gold coin with a shadow, bevel, dotted edge and distinct faces.
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,55,0.34)'; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.arc(154, 181, 105, 0, Math.PI * 2);
  const edge = ctx.createLinearGradient(55, 70, 235, 285);
  edge.addColorStop(0, '#fff3c2'); edge.addColorStop(0.35, '#f8cc62'); edge.addColorStop(1, '#91601b');
  ctx.fillStyle = edge; ctx.fill(); ctx.restore();

  ctx.beginPath(); ctx.arc(154, 181, 92, 0, Math.PI * 2);
  const face = ctx.createLinearGradient(70, 90, 220, 270);
  face.addColorStop(0, '#ffe7a2'); face.addColorStop(0.45, '#dba943'); face.addColorStop(1, '#f5cf76');
  ctx.fillStyle = face; ctx.fill();
  ctx.beginPath(); ctx.arc(154, 181, 83, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(115,70,16,0.42)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(110,65,15,0.48)';
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI * 2) / 32;
    ctx.beginPath(); ctx.arc(154 + Math.cos(angle) * 88, 181 + Math.sin(angle) * 88, 1.7, 0, Math.PI * 2); ctx.fill();
  }

  // Letters make both sides unambiguous even when the image is displayed small.
  ctx.fillStyle = 'rgba(102,57,9,0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `91px "${FONT.bold}"`; ctx.fillText(result === 'Heads' ? 'H' : 'T', 154, 183);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // Result panel: the displayed result always comes from the single toss.
  ctx.fillStyle = '#b4c2ed'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('C O I N   F L I P   /   R E S U L T', 310, 92);
  ctx.fillStyle = '#d9dff8'; ctx.font = `21px "${FONT.regular}"`; ctx.fillText('The coin landed on', 310, 133);
  const gold = ctx.createLinearGradient(310, 150, 650, 218); gold.addColorStop(0, '#fff8de'); gold.addColorStop(1, '#ffc94d');
  ctx.fillStyle = gold; ctx.font = `68px "${FONT.bold}"`; ctx.fillText(fitText(ctx, result.toUpperCase(), 460), 310, 211);
  roundRect(ctx, 310, 244, 460, 52, 15); ctx.fillStyle = 'rgba(8,10,28,0.50)'; ctx.fill();
  ctx.fillStyle = '#aeb9e5'; ctx.font = `13px "${FONT.semi}"`; ctx.fillText('FLIPPED BY', 330, 264);
  ctx.fillStyle = '#ffffff'; ctx.font = `17px "${FONT.semi}"`; ctx.fillText(fitText(ctx, username, 400), 330, 285);
  return canvas.encode('png');
}

/** Generic premium result cards; full text remains available in the accompanying embed. */
async function featureCard({ eyebrow, title, detail, badge, footer, accent = '#5865f2' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);
  ctx.save(); ctx.shadowColor = `${accent}88`; ctx.shadowBlur = 26;
  roundRect(ctx, 62, 74, 152, 152, 38); ctx.fillStyle = accent; ctx.fill(); ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `42px "${FONT.bold}"`;
  ctx.fillText(fitText(ctx, String(badge ?? '★'), 122), 138, 150);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#aebef5'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText(fitText(ctx, String(eyebrow).toUpperCase(), 610), 250, 92);
  ctx.fillStyle = '#ffffff'; ctx.font = `40px "${FONT.bold}"`; ctx.fillText(fitText(ctx, String(title), 590), 250, 153);
  ctx.fillStyle = '#c6d0ee'; ctx.font = `21px "${FONT.regular}"`; ctx.fillText(fitText(ctx, String(detail), 590), 250, 198);
  roundRect(ctx, 250, 238, 580, 53, 15); ctx.fillStyle = 'rgba(5,8,24,0.48)'; ctx.fill();
  ctx.fillStyle = '#dce5ff'; ctx.font = `16px "${FONT.semi}"`; ctx.fillText(fitText(ctx, String(footer), 540), 270, 271);
  return canvas.encode('png');
}

/** Calculator card; the expression and result are supplied from the command's single evaluation. */
async function calculatorCard({ expression, result, accent = '#00e5ff' }) {
  if (!canvasLib) return null;
  const canvas = canvasLib.createCanvas(W, H), ctx = canvas.getContext('2d');
  background(ctx, accent);

  ctx.fillStyle = '#a4b6e9'; ctx.font = `14px "${FONT.semi}"`;
  ctx.fillText('B L U E Z   /   U T I L I T Y', 55, 68);
  ctx.fillStyle = '#ffffff'; ctx.font = `35px "${FONT.bold}"`;
  ctx.fillText('Calculator', 55, 112);

  // Expression panel wraps at character boundaries and scales down if needed.
  roundRect(ctx, 52, 132, 558, 104, 18); ctx.fillStyle = 'rgba(7,11,31,0.72)'; ctx.fill();
  ctx.fillStyle = '#8fa4d5'; ctx.font = `12px "${FONT.semi}"`; ctx.fillText('EXPRESSION', 72, 155);
  const text = clean(String(expression).replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[−–]/g, '-'));
  const wrap = (value, width) => {
    const lines = []; let line = '';
    for (const ch of value) {
      if (line && ctx.measureText(line + ch).width > width) { lines.push(line); line = ''; }
      line += ch;
    }
    if (line) lines.push(line);
    return lines;
  };
  let lines = [], size = 22;
  for (; size >= 15; size--) {
    ctx.font = `${size}px "${FONT.semi}"`;
    lines = wrap(text, 515);
    if (lines.length <= 3) break;
  }
  // Use the full text embed rather than an unreadably small image for long expressions.
  if (lines.length > 3) throw new Error('Expression is too long to render clearly');
  ctx.fillStyle = '#d9e5ff';
  const step = Math.min(25, size + 4);
  lines.forEach((line, i) => ctx.fillText(line, 72, 177 + i * step));

  roundRect(ctx, 52, 250, 558, 66, 18); ctx.fillStyle = 'rgba(0,229,255,0.10)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,229,255,0.32)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#9fdce8'; ctx.font = `12px "${FONT.semi}"`; ctx.fillText('RESULT', 72, 272);
  ctx.fillStyle = '#ffffff'; ctx.font = `29px "${FONT.bold}"`; ctx.fillText(fitText(ctx, result, 510), 72, 301);

  // Decorative calculator, with no external assets or fonts required.
  ctx.save(); ctx.shadowColor = `${accent}66`; ctx.shadowBlur = 24;
  roundRect(ctx, 672, 63, 152, 232, 26); ctx.fillStyle = 'rgba(12,19,45,0.95)'; ctx.fill(); ctx.restore();
  roundRect(ctx, 672, 63, 152, 232, 26); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.stroke();
  roundRect(ctx, 690, 82, 116, 49, 10); ctx.fillStyle = 'rgba(0,229,255,0.13)'; ctx.fill();
  ctx.fillStyle = '#8beefe'; ctx.textAlign = 'right'; ctx.font = `25px "${FONT.bold}"`; ctx.fillText('=', 790, 116); ctx.textAlign = 'left';
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
    roundRect(ctx, 690 + col * 40, 145 + row * 34, 31, 25, 7);
    ctx.fillStyle = row === 3 && col === 2 ? accent : 'rgba(255,255,255,0.12)'; ctx.fill();
  }
  return canvas.encode('png');
}

/** Branded manual invoice. Full values also accompany the image in the DM. */
async function invoiceCard({ serverName, icon, product, amount, invoiceId, date, recipientId, accent = '#5865f2' }) {
  if (!canvasLib) return null;
  if (!Buffer.isBuffer(icon) || !icon.length) throw new Error('A server logo is required.');
  const logo = await canvasLib.loadImage(icon);
  const canvas = canvasLib.createCanvas(1200, 700), ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1200, 700);
  bg.addColorStop(0, '#080e20'); bg.addColorStop(0.52, '#111a33'); bg.addColorStop(1, '#102b3d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 700);
  glow(ctx, 1050, 65, 330, `${accent}55`); glow(ctx, 90, 630, 280, 'rgba(0,210,255,0.12)');
  roundRect(ctx, 24, 24, 1152, 652, 30); ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; ctx.stroke();

  // The actual Discord server icon is required; never replace it with initials.
  ctx.save(); ctx.beginPath(); ctx.arc(118, 111, 55, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(logo, 63, 56, 110, 110); ctx.restore();
  ctx.beginPath(); ctx.arc(118, 111, 57, 0, Math.PI * 2); ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#a7b9e1'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('SERVER INVOICE', 194, 69);

  // Fit full values in their allocated area without cutting words, graphemes or text.
  function drawWrapped(value, x, y, width, maxLines, initialSize, minSize, color) {
    const text = String(value).replace(/[\r\n\t]/g, ' ');
    let lines = [], size;
    for (size = initialSize; size >= minSize; size--) {
      ctx.font = `${size}px "${FONT.semi}", "Noto Sans Devanagari"`;
      lines = wrapPreservingText(text, width, s => ctx.measureText(s).width);
      if (lines.length <= maxLines && lines.every(line => ctx.measureText(line).width <= width)) break;
    }
    if (size < minSize || !lines.length) throw new Error('Invoice text is too long to render clearly.');
    ctx.fillStyle = color; lines.forEach((line, i) => ctx.fillText(line, x, y + i * (size + 5)));
  }
  drawWrapped(serverName, 194, 103, 758, 3, 29, 17, '#ffffff');
  roundRect(ctx, 977, 61, 158, 40, 12); ctx.fillStyle = 'rgba(96,138,245,0.18)'; ctx.fill();
  ctx.fillStyle = '#c1d8ff'; ctx.font = `14px "${FONT.semi}"`; ctx.fillText('MANUAL', 1022, 87);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(62, 189, 1076, 1);

  roundRect(ctx, 62, 219, 688, 255, 22); ctx.fillStyle = 'rgba(4,10,26,0.58)'; ctx.fill();
  ctx.fillStyle = '#98abd2'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('PRODUCT / SERVICE', 90, 260);
  drawWrapped(product, 90, 307, 626, 3, 34, 15, '#ffffff');
  ctx.fillStyle = '#91a7cf'; ctx.font = `16px "${FONT.regular}"`; ctx.fillText('A manual invoice from this server', 90, 444);

  roundRect(ctx, 770, 219, 368, 255, 22); ctx.fillStyle = 'rgba(74,115,231,0.14)'; ctx.fill();
  ctx.strokeStyle = 'rgba(125,166,255,0.27)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#a4bee7'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('TOTAL AMOUNT', 800, 261);
  drawWrapped(amount, 800, 319, 310, 1, 38, 20, '#ffffff');
  ctx.fillStyle = '#afc4e8'; ctx.font = `15px "${FONT.regular}"`; ctx.fillText('INR', 800, 352);

  roundRect(ctx, 62, 495, 1076, 106, 19); ctx.fillStyle = 'rgba(255,255,255,0.055)'; ctx.fill();
  ctx.fillStyle = '#96aad4'; ctx.font = `13px "${FONT.semi}"`;
  ctx.fillText('INVOICE ID', 89, 528); ctx.fillText('DATE (UTC)', 480, 528); ctx.fillText('RECIPIENT ID', 727, 528);
  ctx.fillStyle = '#e5eeff'; ctx.font = `18px "${FONT.semi}"`;
  ctx.fillText(invoiceId, 89, 561); ctx.fillText(date, 480, 561); ctx.fillText(recipientId, 727, 561);
  ctx.fillStyle = '#a7badf'; ctx.font = `16px "${FONT.regular}"`;
  ctx.fillText('Payment is not verified. This is not a payment receipt.', 66, 643);
  return canvas.encode('png');
}

// Itemized invoice: keeps each item, line total and optional note visible in the PNG.
async function invoiceDetailedCard({ serverName, icon, items, totalPaise, note, invoiceId, date, recipientId, status, accent = '#5865f2' }) {
  if (!canvasLib) return null;
  if (!Buffer.isBuffer(icon) || !icon.length) throw new Error('A server logo is required.');
  const { formatPrice } = require('./invoice');
  const logo = await canvasLib.loadImage(icon);
  const panelHeight = 85 + items.length * 65, panelBottom = 215 + panelHeight;
  const footerShift = note ? 0 : -60, height = panelBottom + 315 + footerShift;
  const canvas = canvasLib.createCanvas(1200, height), ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1200, height);
  bg.addColorStop(0, '#080e20'); bg.addColorStop(0.55, '#111a33'); bg.addColorStop(1, '#102b3d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, height);
  glow(ctx, 1050, 65, 330, `${accent}55`);
  roundRect(ctx, 24, 24, 1152, height - 48, 30); ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.arc(118, 111, 55, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, 63, 56, 110, 110); ctx.restore();
  ctx.beginPath(); ctx.arc(118, 111, 57, 0, Math.PI * 2); ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
  function text(value, x, y, width, maxLines, initial, min, color) {
    let lines, size;
    for (size = initial; size >= min; size--) {
      ctx.font = `${size}px "${FONT.semi}", "Noto Sans Devanagari"`;
      lines = wrapPreservingText(String(value), width, s => ctx.measureText(s).width);
      if (lines.length <= maxLines && lines.every(line => ctx.measureText(line).width <= width)) break;
    }
    if (size < min) throw new Error('Invoice text is too long to render clearly.');
    ctx.fillStyle = color; lines.forEach((line, i) => ctx.fillText(line, x, y + i * (size + 4)));
  }
  ctx.fillStyle = '#a7b9e1'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('SERVER INVOICE', 194, 69);
  text(serverName, 194, 103, 900, 3, 29, 17, '#ffffff');
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(62, 190, 1076, 1);
  roundRect(ctx, 62, 215, 1076, panelHeight, 22); ctx.fillStyle = 'rgba(4,10,26,0.58)'; ctx.fill();
  ctx.fillStyle = '#98abd2'; ctx.font = `15px "${FONT.semi}"`;
  ctx.fillText('PRODUCT / SERVICE', 90, 251); ctx.fillText('QTY × UNIT PRICE', 670, 251); ctx.fillText('LINE TOTAL', 937, 251);
  items.forEach((item, i) => {
    const y = 286 + i * 65;
    text(item.name, 90, y, 545, 2, 22, 10, '#ffffff');
    text(`${item.quantity} × ${formatPrice(item.unitPaise)}`, 670, y, 240, 1, 17, 11, '#d1ddf4');
    text(formatPrice(item.unitPaise * item.quantity), 937, y, 170, 1, 18, 11, '#ffffff');
  });
  ctx.fillStyle = '#a4bee7'; ctx.font = `15px "${FONT.semi}"`; ctx.fillText('TOTAL AMOUNT', 90, panelBottom + 49);
  text(formatPrice(totalPaise), 90, panelBottom + 89, 480, 1, 34, 20, '#ffffff');
  text(status === 'paid' ? 'PAID — STAFF MARKED (NOT VERIFIED)' : 'UNPAID — STAFF STATUS (NOT VERIFIED)', 620, panelBottom + 65, 480, 2, 16, 12, '#c1d8ff');
  if (note) { ctx.fillStyle = '#98abd2'; ctx.font = `14px "${FONT.semi}"`; ctx.fillText('NOTE', 90, panelBottom + 128); text(note, 90, panelBottom + 154, 1020, 2, 17, 9, '#d1ddf4'); }
  ctx.fillStyle = '#96aad4'; ctx.font = `13px "${FONT.semi}"`;
  ctx.fillText('INVOICE ID', 90, panelBottom + 214 + footerShift); ctx.fillText('DATE (UTC)', 480, panelBottom + 214 + footerShift); ctx.fillText('RECIPIENT ID', 727, panelBottom + 214 + footerShift);
  ctx.fillStyle = '#e5eeff'; ctx.font = `17px "${FONT.semi}"`;
  ctx.fillText(invoiceId, 90, panelBottom + 241 + footerShift); ctx.fillText(date, 480, panelBottom + 241 + footerShift); ctx.fillText(recipientId, 727, panelBottom + 241 + footerShift);
  ctx.fillStyle = '#a7badf'; ctx.font = `14px "${FONT.regular}"`; ctx.fillText('Payment is not verified. This is not a payment receipt.', 90, panelBottom + 275 + footerShift);
  return canvas.encode('png');
}

module.exports = { available, pingCard, rankCard, welcomeCard, leaderboardCard, profileCard, orderCard, serverCard, levelUpCard, botInfoCard, ltcPriceCard, coinFlipCard, featureCard, calculatorCard, invoiceCard, invoiceDetailedCard, quality };
