/**
 * utils/ltc.js
 * ---------------------------------------------------------------
 * Litecoin helpers:
 *   isAddress(text)                 basic format check of an LTC address
 *   getRates()                      live price of 1 LTC -> { inr, usd }
 *   toLtc(amount, currency)         convert INR / USD to LTC
 *   paymentQr(address, ltcAmount)   PNG buffer of a "litecoin:" payment QR
 *   lookupTx(txid)                  read a transaction from a public block explorer
 *   paidTo(tx, address)             LTC that the transaction sends to `address`
 *
 * Public APIs (no key needed). Each has a second source as a fallback:
 *   price:        CoinGecko -> Coinbase
 *   transactions: litecoinspace.org -> BlockCypher
 * ---------------------------------------------------------------
 */
const QRCode = require('qrcode');

const RATE_CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const SATS = 100_000_000;

let rateCache = { at: 0, rates: null };

/** Legacy (L…/M…/3…) or bech32 (ltc1…) address. Format check only. */
const isAddress = (text) => /^(?:[LM3][1-9A-HJ-NP-Za-km-z]{25,34}|ltc1[02-9ac-hj-np-z]{11,71})$/.test(String(text ?? '').trim());

/** A transaction ID is 64 hex characters. */
const isTxid = (text) => /^[0-9a-f]{64}$/i.test(String(text ?? '').trim());

/**
 * Pull the transaction ID out of what a user pasted: the ID itself or an
 * explorer link that contains it (".../tx/<id>"). Returns '' when there is none.
 */
const extractTxid = (text) => String(text ?? '').match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i)?.[0].toLowerCase() ?? '';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'discord-bot' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

/** Live price of 1 LTC. Cached for one minute. */
async function getRates() {
  if (rateCache.rates && Date.now() - rateCache.at < RATE_CACHE_MS) return rateCache.rates;

  const sources = [
    async () => {
      const data = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=inr,usd');
      return { inr: Number(data?.litecoin?.inr), usd: Number(data?.litecoin?.usd) };
    },
    async () => {
      const data = await getJson('https://api.coinbase.com/v2/exchange-rates?currency=LTC');
      return { inr: Number(data?.data?.rates?.INR), usd: Number(data?.data?.rates?.USD) };
    },
  ];

  let lastError;
  for (const source of sources) {
    try {
      const rates = await source();
      if (rates.inr > 0 && rates.usd > 0) {
        rateCache = { at: Date.now(), rates };
        return rates;
      }
      lastError = new Error('price source returned no price');
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not load the LTC price (${lastError?.message ?? 'unknown error'})`);
}

/** Convert an amount to LTC (8 decimals). currency: 'INR' | 'USD' | 'LTC' */
async function toLtc(amount, currency = 'INR') {
  if (currency === 'LTC') return { ltc: Math.round(amount * SATS) / SATS, rates: await getRates().catch(() => null) };
  const rates = await getRates();
  const price = currency === 'USD' ? rates.usd : rates.inr;
  return { ltc: Math.ceil((amount / price) * SATS) / SATS, rates };
}

/** "0.01230000" -> "0.0123" */
const formatLtc = (ltc) => ltc.toFixed(8).replace(/\.?0+$/, '');

/** litecoin:<address>?amount=<ltc> (understood by wallets when scanned). */
const paymentUri = (address, ltc) => `litecoin:${address}?amount=${formatLtc(ltc)}`;

/** PNG buffer of the payment QR. */
const paymentQr = (address, ltc) => QRCode.toBuffer(paymentUri(address, ltc), { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });

/** Sum and format integer litoshis without floating point rounding. */
function sumSats(outputs, address) {
  let total = 0;
  for (const output of outputs) {
    if (address !== undefined && output.address !== address) continue;
    if (!Number.isSafeInteger(output.sats) || output.sats < 0 || !Number.isSafeInteger(total + output.sats)) throw new Error('Invalid transaction output amount');
    total += output.sats;
  }
  return total;
}
function formatSats(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid litoshi amount');
  const n = BigInt(value), whole = n / 100000000n, fraction = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * A chain observation, not proof that an order was paid or that a tx is final.
 * Confirmations can be null if the tip height cannot be fetched.
 * Outputs are kept once per output, including those without a standard address.
 */
async function lookupTx(txid) {
  const id = String(txid ?? '').trim().toLowerCase();
  if (!isTxid(id)) throw new Error('Invalid transaction ID');
  function output(value, address) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid transaction output');
    return { address: typeof address === 'string' ? address : '', sats: value };
  }
  function finish(outputs, confirmed, confirmations, time, source) {
    sumSats(outputs);
    return { outputs, confirmed, confirmations, time, source };
  }
  const sources = [
    async () => {
      const tx = await getJson(`https://litecoinspace.org/api/tx/${id}`);
      if (!tx) return null;
      if (typeof tx.txid !== 'string' || tx.txid.toLowerCase() !== id) throw new Error('Explorer returned a different transaction');
      if (!Array.isArray(tx.vout) || !tx.vout.length || typeof tx.status?.confirmed !== 'boolean') throw new Error('Invalid explorer response');
      const outputs = tx.vout.map(o => output(o.value, o.scriptpubkey_address));
      const confirmed = tx.status.confirmed;
      let confirmations = confirmed ? null : 0;
      if (confirmed && Number.isSafeInteger(tx.status.block_height) && tx.status.block_height >= 0) {
        try {
          const tip = await getJson('https://litecoinspace.org/api/blocks/tip/height');
          if (Number.isSafeInteger(tip) && tip >= tx.status.block_height) confirmations = tip - tx.status.block_height + 1;
        } catch { /* Keep the known confirmation status but never invent a count. */ }
      }
      const blockTime = tx.status.block_time;
      return finish(outputs, confirmed, confirmations, Number.isFinite(blockTime) && blockTime > 0 ? blockTime * 1000 : null, 'LitecoinSpace');
    },
    async () => {
      const tx = await getJson(`https://api.blockcypher.com/v1/ltc/main/txs/${id}?limit=2000`);
      if (!tx) return null;
      if (typeof tx.hash !== 'string' || tx.hash.toLowerCase() !== id) throw new Error('Explorer returned a different transaction');
      // BlockCypher paginates outputs. Never report or verify an incomplete or conflicting set.
      if (!Array.isArray(tx.outputs) || !Number.isSafeInteger(tx.vout_sz) || tx.vout_sz < 1 || tx.outputs.length !== tx.vout_sz || !Number.isSafeInteger(tx.confirmations) || tx.confirmations < 0 || tx.double_spend === true) throw new Error('Incomplete or invalid explorer response');
      const outputs = tx.outputs.map(o => output(o.value, Array.isArray(o.addresses) && o.addresses.length === 1 ? o.addresses[0] : ''));
      const when = Date.parse(tx.confirmed ?? tx.received ?? '');
      return finish(outputs, tx.confirmations > 0, tx.confirmations, Number.isNaN(when) ? null : when, 'BlockCypher');
    },
  ];
  let lastError, notFound = 0;
  for (const source of sources) {
    try { const tx = await source(); if (tx) return tx; notFound++; }
    catch (err) { lastError = err; }
  }
  if (notFound === sources.length) return null;
  throw new Error(`Block explorers are unavailable or returned incomplete data (${lastError?.message ?? 'unknown error'})`);
}

/** LTC that `tx` pays to `address`, retained for the shop integration. */
const paidTo = (tx, address) => sumSats(tx.outputs, address) / SATS;

module.exports = { isAddress, isTxid, extractTxid, getRates, toLtc, formatLtc, paymentUri, paymentQr, lookupTx, paidTo, sumSats, formatSats };
