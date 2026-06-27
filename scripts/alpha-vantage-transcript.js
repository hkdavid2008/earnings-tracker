/*
 * Alpha Vantage earnings call transcript fetcher and rule-based analyzer.
 * The endpoint requires symbol + fiscal quarter, so we probe recent quarters.
 */

const AV_BASE_URL = process.env.ALPHA_VANTAGE_BASE_URL || 'https://www.alphavantage.co/query';

function getAlphaVantageApiKey() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error('Missing ALPHA_VANTAGE_API_KEY. It is required for earnings call transcripts.');
  return key;
}

function quarterFromDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}Q${quarter}`;
}

function previousQuarter(quarter) {
  const match = String(quarter).match(/^(\d{4})Q([1-4])$/);
  if (!match) throw new Error(`Invalid quarter: ${quarter}`);
  let year = Number(match[1]);
  let q = Number(match[2]);
  q -= 1;
  if (q === 0) {
    q = 4;
    year -= 1;
  }
  return `${year}Q${q}`;
}

function recentQuarterCandidates(anchorDate = new Date(), count = 6) {
  const quarters = [];
  let current = quarterFromDate(anchorDate);
  for (let i = 0; i < count; i += 1) {
    quarters.push(current);
    current = previousQuarter(current);
  }
  return quarters;
}

async function fetchTranscript(symbol, quarter) {
  const apiKey = getAlphaVantageApiKey();
  const url = `${AV_BASE_URL}?function=EARNINGS_CALL_TRANSCRIPT&symbol=${encodeURIComponent(symbol)}&quarter=${encodeURIComponent(quarter)}&apikey=${apiKey}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Alpha Vantage HTTP ${response.status}: ${text}`);
  const data = JSON.parse(text);

  if (data.Note || data.Information || data['Error Message']) {
    return { symbol, quarter, available: false, raw: data };
  }

  const transcript = data.transcript || data.Transcript || data.transcripts || data.content || data;
  const turns = Array.isArray(transcript) ? transcript : Array.isArray(data) ? data : [];
  const hasText = turns.some((row) => String(row.content || row.text || row.speech || '').trim());

  return {
    symbol,
    quarter,
    available: hasText,
    turns,
    raw: data
  };
}

async function fetchLatestTranscript(symbol, anchorDate = new Date()) {
  const candidates = recentQuarterCandidates(anchorDate, Number.parseInt(process.env.TRANSCRIPT_QUARTER_LOOKBACK || '6', 10));

  for (const quarter of candidates) {
    const result = await fetchTranscript(symbol, quarter);
    if (result.available) return result;
  }

  return { symbol, quarter: candidates[0], available: false, turns: [] };
}

function getTurnText(turn) {
  return String(turn.content || turn.text || turn.speech || turn.transcript || '').trim();
}

function getSpeaker(turn) {
  return String(turn.speaker || turn.name || turn.role || '').trim();
}

function getSentiment(turn) {
  const raw = turn.sentiment || turn.sentiment_score || turn.sentimentScore || turn.score;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function countKeywordHits(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
}

function analyzeTranscript(transcriptResult) {
  if (!transcriptResult.available) {
    return {
      available: false,
      summary: '未找到可用的 earnings call transcript。可能是电话会尚未发布，或 Alpha Vantage 尚未覆盖该季度。'
    };
  }

  const turns = transcriptResult.turns.map((turn) => ({
    speaker: getSpeaker(turn),
    text: getTurnText(turn),
    sentiment: getSentiment(turn)
  })).filter((turn) => turn.text);

  const fullText = turns.map((turn) => turn.text).join('\n');
  const sentiments = turns.map((turn) => turn.sentiment).filter((value) => value !== null);
  const avgSentiment = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null;

  const topicGroups = [
    { name: 'AI/数据中心', keywords: ['ai', 'artificial intelligence', 'data center', 'accelerator', 'gpu', 'inference'] },
    { name: '云/软件', keywords: ['cloud', 'software', 'subscription', 'saas', 'workload'] },
    { name: '利润率/成本', keywords: ['margin', 'gross margin', 'operating margin', 'cost', 'opex'] },
    { name: '指引/需求', keywords: ['guidance', 'outlook', 'demand', 'pipeline', 'backlog'] },
    { name: '库存/供应链', keywords: ['inventory', 'supply', 'capacity', 'lead time', 'channel'] }
  ];

  const topics = topicGroups
    .map((group) => ({ name: group.name, hits: countKeywordHits(fullText, group.keywords) }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 4);

  const riskKeywords = ['weak', 'decline', 'pressure', 'headwind', 'uncertain', 'slowdown', 'inventory correction', 'competition'];
  const positiveKeywords = ['strong', 'accelerate', 'growth', 'record', 'beat', 'robust', 'improve', 'expansion'];

  const riskSentences = extractSentences(fullText, riskKeywords, 4);
  const positiveSentences = extractSentences(fullText, positiveKeywords, 4);

  return {
    available: true,
    quarter: transcriptResult.quarter,
    turnCount: turns.length,
    avgSentiment,
    topics,
    positives: positiveSentences,
    risks: riskSentences
  };
}

function extractSentences(text, keywords, limit = 4) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => countKeywordHits(sentence, keywords) > 0)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, limit);
}

module.exports = {
  fetchTranscript,
  fetchLatestTranscript,
  analyzeTranscript,
  recentQuarterCandidates
};
