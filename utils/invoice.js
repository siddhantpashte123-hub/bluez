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

// Item arithmetic is always performed in integer paise, never floating point.
const MAX_TOTAL = 9_999_999_999;
function quantity(value) {
  const text = String(value ?? '').trim() || '1';
  if (!/^[1-9]\d{0,3}$/.test(text)) throw new Error('Quantity must be a whole number from 1 to 9999.');
  return Number(text);
}
function parseItems(product, price, qty, extra = '') {
  const items = [{ name: productName(product), quantity: quantity(qty), unitPaise: parsePrice(price) }];
  const lines = String(extra).trim() ? String(extra).trim().split(/\r?\n/) : [];
  if (lines.length > 4) throw new Error('Add at most 4 extra items.');
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length !== 3 || !parts[1].trim()) throw new Error('Extra items must use one line each: name | quantity | unit price.');
    items.push({ name: productName(parts[0]), quantity: quantity(parts[1]), unitPaise: parsePrice(parts[2]) });
  }
  let total = 0;
  for (const item of items) {
    total += item.unitPaise * item.quantity;
    if (total > MAX_TOTAL) throw new Error('Invoice total cannot exceed ₹9,99,99,999.99.');
  }
  return { items, totalPaise: total };
}
function noteText(value) {
  const text = String(value ?? '').trim();
  if (text.length > 200 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Notes must be a single line of up to 200 characters.');
  return text;
}
module.exports.parseItems = parseItems;
module.exports.noteText = noteText;
