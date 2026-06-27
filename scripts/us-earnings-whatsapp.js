#!/usr/bin/env node
/*
 * Daily US earnings pipeline:
 * 1. Build top 1500 US market-cap universe.
 * 2. Pull earnings calendar for the target date.
 * 3. Filter to the universe.
 * 4. Pull and analyze Alpha Vantage earnings call transcripts where available.
 * 5. Send structured report to WhatsApp through Twilio.
 */

const fs = require('fs');
const { getTopUsMarketCapUniverse } = require('./us-market-cap-universe');
const { fetchLatestTranscript, analyzeTranscript } = require('./alpha-vantage-transcript');
const { sendWhatsAppReport } = require('./notifiers/whatsapp-twilio');

const FMP_BASE_URL = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/api/v3';
const OUTPUT_PATH = process.env.EARNINGS_REPORT_PATH || 'earnings_report.md';
const DEFAULT_LIMIT = Number.parseInt(process.env.US_UNIVERSE_LIMIT || '1500', 10);
const MAX_TRANSCRIPTS = Number.parseInt(process.env.MAX_TRANSCRIPTS_PER_RUN || '12', 10);

function getFmpApiKey() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('Missing FMP_API_KEY.');
  return key;
}

function getTargetDate(input) {
  if (input) return input;
  if (process.env.EARNINGS_DATE) return process.env.EARNINGS_DATE;
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function getEarningsCalendarForDate(date) {
  const apiKey = getFmpApiKey();
  const url = `${FMP_BASE_URL}/earning_calendar?from=${date}&to=${date}&apikey=${apiKey}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows)) throw new Error(`Unexpected earnings calendar response: ${JSON.stringify(rows).slice(0, 300)}`);
  return rows;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function filterCalendarToUniverse(calendar, universe) {
  const bySymbol = new Map(universe.map((item) => [normalizeSymbol(item.symbol), item]));

  return calendar
    .filter((item) => bySymbol.has(normalizeSymbol(item.symbol)))
    .map((item) => {
      const base = bySymbol.get(normalizeSymbol(item.symbol));
      return {
        ...base,
        earningsDate: item.date,
        time: item.time || item.hour || 'time-not-confirmed',
        epsEstimated: item.epsEstimated ?? item.epsEstimated ?? null,
        revenueEstimated: item.revenueEstimated ?? null,
        fiscalDateEnding: item.fiscalDateEnding || null,
        updatedFromCalendar: item.updatedFromDate || null
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

async function enrichWithTranscripts(events, targetDate) {
  const enriched = [];

  for (const [index, event] of events.entries()) {
    if (index >= MAX_TRANSCRIPTS) {
      enriched.push({ ...event, transcriptAnalysis: { available: false, summary: `已达到本次 transcript 上限 ${MAX_TRANSCRIPTS}，跳过。` } });
      continue;
    }

    try {
      const transcript = await fetchLatestTranscript(event.symbol, new Date(`${targetDate}T12:00:00Z`));
      const analysis = analyzeTranscript(transcript);
      enriched.push({ ...event, transcriptQuarter: transcript.quarter, transcriptAnalysis: analysis });
    } catch (error) {
      enriched.push({
        ...event,
        transcriptAnalysis: {
          available: false,
          summary: `Transcript 获取失败: ${error.message}`
        }
      });
    }
  }

  return enriched;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'N/A';
  if (Math.abs(number) >= 1e12) return `$${(number / 1e12).toFixed(2)}T`;
  if (Math.abs(number) >= 1e9) return `$${(number / 1e9).toFixed(1)}B`;
  if (Math.abs(number) >= 1e6) return `$${(number / 1e6).toFixed(1)}M`;
  return `$${number.toLocaleString('en-US')}`;
}

function valueOrNA(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  return String(value);
}

function formatSentiment(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  const number = Number(value);
  if (number > 0.15) return `${number.toFixed(3)} 偏正面`;
  if (number < -0.15) return `${number.toFixed(3)} 偏负面`;
  return `${number.toFixed(3)} 中性`;
}

function formatReport(events, targetDate, universeLimit) {
  const generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'America/New_York', hour12: false });
  const lines = [
    `# 美股财报日报 ${targetDate}`,
    '',
    `范围: 美股市值前 ${universeLimit}`,
    `生成时间: ${generatedAt} 美东`,
    `财报公司数: ${events.length}`,
    ''
  ];

  if (events.length === 0) {
    lines.push('今日美股市值前列公司中，未发现匹配财报日历。');
    return lines.join('\n');
  }

  for (const event of events) {
    lines.push(`## ${event.rank}. ${event.name} (${event.symbol})`);
    lines.push(`- 市值: ${money(event.marketCap)} | 行业: ${event.sector || 'N/A'} / ${event.industry || 'N/A'}`);
    lines.push(`- 财报时间: ${event.earningsDate} ${event.time}`);
    lines.push(`- EPS预期: ${valueOrNA(event.epsEstimated)} | 营收预期: ${money(event.revenueEstimated)}`);

    const analysis = event.transcriptAnalysis;
    if (!analysis || !analysis.available) {
      lines.push(`- Transcript: ${analysis?.summary || '未获取到。'}`);
      lines.push('');
      continue;
    }

    lines.push(`- Transcript季度: ${analysis.quarter || event.transcriptQuarter || 'N/A'} | 平均情绪: ${formatSentiment(analysis.avgSentiment)} | 发言轮次: ${analysis.turnCount}`);
    if (analysis.topics?.length) {
      lines.push(`- 高频主题: ${analysis.topics.map((item) => `${item.name}(${item.hits})`).join(', ')}`);
    }
    if (analysis.positives?.length) {
      lines.push('- 正面线索:');
      analysis.positives.slice(0, 2).forEach((item) => lines.push(`  - ${item.slice(0, 220)}`));
    }
    if (analysis.risks?.length) {
      lines.push('- 风险线索:');
      analysis.risks.slice(0, 2).forEach((item) => lines.push(`  - ${item.slice(0, 220)}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function run({ date, send = true, universeLimit = DEFAULT_LIMIT } = {}) {
  const targetDate = getTargetDate(date);
  const universe = await getTopUsMarketCapUniverse(universeLimit);
  const calendar = await getEarningsCalendarForDate(targetDate);
  const events = filterCalendarToUniverse(calendar, universe);
  const enriched = await enrichWithTranscripts(events, targetDate);
  const report = formatReport(enriched, targetDate, universeLimit);

  fs.writeFileSync(OUTPUT_PATH, report, 'utf8');
  console.log(report);

  if (send && process.env.SEND_WHATSAPP !== 'false') {
    await sendWhatsAppReport(report, {
      1: targetDate,
      2: `${events.length}`,
      3: report.slice(0, 900)
    });
  }

  return { targetDate, count: events.length, report };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'run';

  if (command === 'test') {
    await sendWhatsAppReport('earnings-tracker WhatsApp 测试消息', { 1: 'test', 2: '0', 3: '测试消息' });
    console.log('WhatsApp test message sent.');
    return;
  }

  if (command === 'dry-run') {
    await run({ date: args[1], send: false });
    return;
  }

  await run({ date: args[1], send: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  run,
  getEarningsCalendarForDate,
  filterCalendarToUniverse,
  enrichWithTranscripts,
  formatReport
};
