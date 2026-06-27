/*
 * Build the US top market-cap universe from Financial Modeling Prep.
 * This is intentionally independent from .config/watchlist.json because the
 * production requirement is top 1500 US stocks, not a hand-maintained watchlist.
 */

const DEFAULT_LIMIT = Number.parseInt(process.env.US_UNIVERSE_LIMIT || '1500', 10);
const FMP_BASE_URL = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/api/v3';

function getFmpApiKey() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('Missing FMP_API_KEY. It is required for top market-cap universe and earnings calendar.');
  return key;
}

function isCommonUsStock(item) {
  const symbol = String(item.symbol || '').trim();
  if (!symbol) return false;
  if (symbol.includes('.')) return false;
  if (symbol.includes('-')) return false;

  const exchange = String(item.exchangeShortName || item.exchange || '').toUpperCase();
  const allowedExchanges = new Set(['NASDAQ', 'NYSE', 'AMEX']);
  if (exchange && !allowedExchanges.has(exchange)) return false;

  const type = String(item.type || '').toLowerCase();
  if (type && !['stock', 'common stock', 'common'].includes(type)) return false;

  return true;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`FMP HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function getTopUsMarketCapUniverse(limit = DEFAULT_LIMIT) {
  const apiKey = getFmpApiKey();
  const url = `${FMP_BASE_URL}/stock-screener?marketCapMoreThan=1000000&isActivelyTrading=true&limit=${Math.max(limit * 2, limit)}&apikey=${apiKey}`;
  const rows = await fetchJson(url);

  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected FMP stock screener response: ${JSON.stringify(rows).slice(0, 300)}`);
  }

  return rows
    .filter(isCommonUsStock)
    .sort((a, b) => Number(b.marketCap || 0) - Number(a.marketCap || 0))
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      symbol: item.symbol,
      name: item.companyName || item.company || item.symbol,
      marketCap: Number(item.marketCap || 0),
      sector: item.sector || '',
      industry: item.industry || '',
      exchange: item.exchangeShortName || item.exchange || ''
    }));
}

module.exports = {
  getTopUsMarketCapUniverse,
  isCommonUsStock
};
