#!/usr/bin/env node
/**
 * Generate a mobile-friendly earnings report.
 * The GitHub Actions workflow can create a GitHub issue from this output,
 * so the GitHub mobile app can deliver the phone notification.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../.config/watchlist.json');
const OUTPUT_PATH = process.env.EARNINGS_REPORT_PATH || 'earnings_report.md';
const SHOULD_NOTIFY_PATH = process.env.EARNINGS_SHOULD_NOTIFY_PATH || 'should_notify.txt';
const LOOKAHEAD_DAYS = Number.parseInt(process.env.LOOKAHEAD_DAYS || '7', 10);

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function normalizeProviderId(providerId) {
  const value = String(providerId || '').trim();
  const aliases = {
    fmp: 'financialModelingPrep',
    financialmodelingprep: 'financialModelingPrep',
    alpha: 'alphaVantage',
    alphavantage: 'alphaVantage',
    av: 'alphaVantage',
    yahoo: 'yahooFinance',
    yfinance: 'yahooFinance'
  };
  return aliases[value.toLowerCase()] || value;
}

function getProvider(providerId) {
  const id = normalizeProviderId(providerId || process.env.EARNINGS_PROVIDER || 'fmp');

  switch (id) {
    case 'financialModelingPrep':
      return { id, source: require('./data-sources/fmp') };
    case 'alphaVantage':
      return { id, source: require('./data-sources/alpha-vantage') };
    case 'yahooFinance':
      return { id, source: require('./data-sources/yahoo-finance') };
    case 'sina':
      return { id, source: require('./data-sources/sina') };
    case 'mock':
      return { id, source: require('./data-sources/mock') };
    default:
      throw new Error(`未知数据源: ${providerId}`);
  }
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function getMarketConfig(config, market) {
  const marketCode = String(market || process.env.EARNINGS_MARKET || 'us').toLowerCase();
  const marketConfig = config.markets?.[marketCode];
  if (!marketConfig) throw new Error(`未知市场: ${marketCode}. 可用市场: ${Object.keys(config.markets || {}).join(', ')}`);
  return { marketCode, marketConfig };
}

function getWatchlist(config, market, sector) {
  const { marketCode, marketConfig } = getMarketConfig(config, market);
  const sectorFilter = String(sector || process.env.EARNINGS_SECTOR || '').trim().toLowerCase();

  let companies = marketConfig.companies || [];
  if (sectorFilter) {
    companies = companies.filter((item) => String(item.sector || '').toLowerCase() === sectorFilter);
  }

  return companies.map((item) => ({
    ...item,
    market: marketCode,
    marketName: marketConfig.name,
    currency: marketConfig.currency,
    timezone: marketConfig.timezone
  }));
}

function isWithinLookahead(dateText, days = LOOKAHEAD_DAYS) {
  if (!dateText || dateText === 'N/A') return true;

  const eventDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(eventDate.getTime())) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setDate(today.getDate() + days);

  return eventDate >= today && eventDate <= end;
}

function mergeCalendarWithWatchlist(calendar, watchlist) {
  const watchMap = new Map(watchlist.map((item) => [normalizeSymbol(item.symbol), item]));

  return (calendar || [])
    .filter((item) => watchMap.has(normalizeSymbol(item.symbol)))
    .filter((item) => isWithinLookahead(item.date))
    .map((item) => {
      const company = watchMap.get(normalizeSymbol(item.symbol));
      return {
        ...company,
        ...item,
        name: company.name || item.name || item.symbol,
        sector: company.sector,
        industry: company.industry,
        currency: item.currency || company.currency || 'USD'
      };
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || normalizeSymbol(a.symbol).localeCompare(normalizeSymbol(b.symbol)));
}

function formatPreview(events, watchlist, options) {
  const marketName = options.marketConfig.name;
  const sectorText = options.sector ? ` / ${options.sector}` : '';
  const nowText = new Date().toLocaleString('zh-CN', { timeZone: 'America/New_York', hour12: false });

  const lines = [
    '# 财报日历手机提醒',
    '',
    `范围: ${marketName}${sectorText}`,
    `周期: 未来 ${options.lookaheadDays} 天`,
    `数据源: ${options.providerId}`,
    `生成时间: ${nowText} 美东`,
    ''
  ];

  if (!events.length) {
    lines.push(`未来 ${options.lookaheadDays} 天，关注列表中暂无匹配财报。`);
    lines.push('');
    lines.push(`关注股票数: ${watchlist.length}`);
    return { text: lines.join('\n'), shouldNotify: false };
  }

  lines.push(`共 ${events.length} 家关注公司有财报:`);
  lines.push('');

  let currentDate = '';
  for (const item of events) {
    if (item.date !== currentDate) {
      currentDate = item.date || '日期待确认';
      lines.push(`## ${currentDate}`);
      lines.push('');
    }

    const timeText = item.time === 'pre' ? '盘前' : item.time === 'after' ? '盘后' : (item.time || '时间待确认');
    lines.push(`- **${item.name} (${item.symbol})** | ${timeText} | ${item.industry || '行业待确认'}`);
    lines.push(`  - EPS预期: ${formatValue(item.expectedEPS)}`);
    lines.push(`  - 营收预期: ${formatValue(item.expectedRevenue)} ${item.currency || ''}`.trimEnd());
  }

  return { text: lines.join('\n'), shouldNotify: true };
}

function formatSummary(summary, symbol, providerId) {
  if (!summary) {
    return { text: `# ${symbol} 财报摘要\n\n未获取到财报摘要。数据源: ${providerId}`, shouldNotify: false };
  }

  const lines = [
    `# ${summary.name || symbol} (${summary.symbol || symbol}) 财报摘要`,
    '',
    `数据源: ${summary.source || providerId}`,
    `日期/季度: ${summary.date || summary.quarter || 'N/A'}`,
    '',
    `- EPS: ${formatValue(summary.actualEPS)} (预期: ${formatValue(summary.expectedEPS)})`,
    `- 营收: ${formatValue(summary.actualRevenue)} (预期: ${formatValue(summary.expectedRevenue)})`,
    `- 同比增速: ${formatValue(summary.yoyGrowth)}`,
    ''
  ];

  if (Array.isArray(summary.highlights) && summary.highlights.length > 0) {
    lines.push('## 关键项');
    summary.highlights.slice(0, 6).forEach((item) => lines.push(`- ${item}`));
  }

  if (summary.guidance) {
    lines.push('');
    lines.push('## 指引');
    lines.push(summary.guidance);
  }

  return { text: lines.join('\n'), shouldNotify: true };
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  return String(value);
}

function writeOutput(result) {
  fs.writeFileSync(OUTPUT_PATH, result.text, 'utf8');
  fs.writeFileSync(SHOULD_NOTIFY_PATH, result.shouldNotify ? '1' : '0', 'utf8');
  console.log(result.text);
}

async function runPreview(args) {
  const config = loadConfig();
  const market = args[0] || process.env.EARNINGS_MARKET || 'us';
  const sector = args[1] || process.env.EARNINGS_SECTOR || '';
  const providerIdInput = args[2] || process.env.EARNINGS_PROVIDER || 'fmp';
  const { marketCode, marketConfig } = getMarketConfig(config, market);
  const watchlist = getWatchlist(config, marketCode, sector);
  const { id: providerId, source } = getProvider(providerIdInput);

  if (watchlist.length === 0) {
    throw new Error(`关注列表为空: market=${marketCode}, sector=${sector || 'all'}`);
  }

  const calendar = await source.getEarningsCalendar(null, marketCode);
  const events = mergeCalendarWithWatchlist(calendar || [], watchlist);
  const result = formatPreview(events, watchlist, {
    marketCode,
    marketConfig,
    sector,
    providerId,
    lookaheadDays: LOOKAHEAD_DAYS
  });

  writeOutput(result);
}

async function runSummary(args) {
  const symbol = args[0];
  if (!symbol) throw new Error('请提供股票代码，例如: node scripts/earnings-mobile-report.js summary NVDA');

  const market = args[1] || process.env.EARNINGS_MARKET || 'us';
  const providerIdInput = args[2] || process.env.EARNINGS_PROVIDER || 'fmp';
  const { id: providerId, source } = getProvider(providerIdInput);
  const summary = await source.getCompanyEarnings(symbol, market);
  const result = formatSummary(summary, symbol, providerId);

  writeOutput(result);
}

async function runTest() {
  writeOutput({
    text: `# earnings-tracker 手机提醒测试\n\n测试成功。\n\n时间: ${new Date().toISOString()}`,
    shouldNotify: true
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'preview';

  switch (command) {
    case 'preview':
    case 'weekly':
      await runPreview(args.slice(1));
      break;
    case 'summary':
    case 'report':
      await runSummary(args.slice(1));
      break;
    case 'test':
      await runTest();
      break;
    default:
      console.log(`用法:
  node scripts/earnings-mobile-report.js preview [market] [sector] [provider]
  node scripts/earnings-mobile-report.js summary <symbol> [market] [provider]
  node scripts/earnings-mobile-report.js test`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('生成财报提醒失败:', error.message);
    process.exit(1);
  });
}

module.exports = {
  runPreview,
  runSummary,
  runTest,
  formatPreview,
  formatSummary,
  mergeCalendarWithWatchlist
};
