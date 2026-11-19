// Utilities for manual INR invoices; no payment processing or order state changes.
const MAX_ICON_BYTES = 2_000_000;
function parsePrice(value) {
  const text = String(value ?? '').trim();
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('Enter a price from 0.01 to 99,999,999.99 using digits and up to two decimals.');
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error('Price must be greater than zero.');
  return paise;
}
function formatPrice(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function productName(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 100 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Enter a product name of 1–100 characters on one line.');
  return text;
}
async function fetchIcon(guild) {
  const input = guild.iconURL({ extension: 'png', forceStatic: true, size: 256 });
  if (!input) throw new Error('This server has no logo. Set a server icon before sending an invoice.');
  let url;
  try { url = new URL(input); } catch { throw new Error('Could not load the server logo.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.discordapp.com' || url.port || url.username || url.password || !url.pathname.startsWith(`/icons/${guild.id}/`) || !url.pathname.endsWith('.png')) throw new Error('Invalid server logo URL.');
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' }); }
  catch { throw new Error('Could not download the server logo. Try again later.'); }
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_ICON_BYTES) throw new Error('Could not download the server logo.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_ICON_BYTES) throw new Error('Server logo is too large.');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw new Error('Server logo is empty.');
  return Buffer.concat(chunks);
}
module.exports = { parsePrice, formatPrice, productName, fetchIcon };
