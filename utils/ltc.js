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

/**
 * Look a transaction up.
 * @returns {Promise<null | { outputs: {address: string, sats: number}[], confirmed: boolean, time: number|null }>}
 *          null = the explorers do not know this transaction (yet).
 */
async function lookupTx(txid) {
  const id = txid.trim().toLowerCase();
  const sources = [
    async () => {
      const tx = await getJson(`https://litecoinspace.org/api/tx/${id}`);
      if (!tx) return null;
      return {
        outputs: (tx.vout ?? []).map((o) => ({ address: o.scriptpubkey_address ?? '', sats: Number(o.value) || 0 })),
        confirmed: Boolean(tx.status?.confirmed),
        time: tx.status?.block_time ? tx.status.block_time * 1000 : null,
      };
    },
    async () => {
      const tx = await getJson(`https://api.blockcypher.com/v1/ltc/main/txs/${id}?limit=50`);
      if (!tx) return null;
      const when = Date.parse(tx.confirmed ?? tx.received ?? '');
      return {
        outputs: (tx.outputs ?? []).flatMap((o) => (o.addresses ?? []).map((address) => ({ address, sats: Number(o.value) || 0 }))),
        confirmed: Number(tx.confirmations) > 0,
        time: Number.isNaN(when) ? null : when,
      };
    },
  ];

  let lastError;
  let answered = false;
  for (const source of sources) {
    try {
      const tx = await source();
      if (tx) return tx;
      answered = true; // this explorer works but does not know the transaction
    } catch (err) {
      lastError = err;
    }
  }
  if (answered) return null;
  throw new Error(`Block explorers are not reachable (${lastError?.message ?? 'unknown error'})`);
}

/** LTC that `tx` pays to `address`. */
const paidTo = (tx, address) => tx.outputs.filter((o) => o.address === address).reduce((sum, o) => sum + o.sats, 0) / SATS;

module.exports = { isAddress, isTxid, extractTxid, getRates, toLtc, formatLtc, paymentUri, paymentQr, lookupTx, paidTo };
