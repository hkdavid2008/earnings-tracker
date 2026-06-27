/**
 * Financial Modeling Prep Data Source
 * 专业金融数据 API
 * 文档: https://site.financialmodelingprep.com/developer/docs
 * 免费额度: 250 calls/day
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../.config/watchlist.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  config = { dataSource: { options: {} } };
}

const FMP_CONFIG = config.dataSource?.options?.financialModelingPrep || {};
const API_KEY = process.env.FMP_API_KEY || FMP_CONFIG.apiKey;
const BASE_URL = FMP_CONFIG.baseUrl || 'https://financialmodelingprep.com/api/v3';

/**
 * 获取财报日历
 */
async function getEarningsCalendar(symbol = null, market = 'us') {
  if (!API_KEY || API_KEY === 'YOUR_FMP_API_KEY_HERE') {
    throw new Error('FMP API Key 未配置，请设置环境变量 FMP_API_KEY，或在 .config/watchlist.json 中设置');
  }

  try {
    let url;
    if (symbol) {
      // 获取特定公司的财报日历
      url = `${BASE_URL}/earning_calendar/${symbol}?apikey=${API_KEY}`;
    } else {
      // 获取所有公司的财报日历（最近7天）
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      url = `${BASE_URL}/earning_calendar?from=${today}&to=${nextWeekStr}&apikey=${API_KEY}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    // 转换为统一格式
    return data.map(item => ({
      symbol: item.symbol,
      name: item.name || item.symbol,
      date: item.date,
      time: item.time || 'after',
      expectedEPS: item.epsEstimated || 'N/A',
      expectedRevenue: item.revenueEstimated ? (item.revenueEstimated / 1000000).toFixed(1) + 'M' : 'N/A',
      currency: 'USD',
      isRealData: true,
      source: 'FMP'
    }));
  } catch (error) {
    console.error('FMP API 错误:', error.message);
    return null;
  }
}

/**
 * 获取公司财报详情
 */
async function getCompanyEarnings(symbol, market = 'us') {
  if (!API_KEY || API_KEY === 'YOUR_FMP_API_KEY_HERE') {
    throw new Error('FMP API Key 未配置，请设置环境变量 FMP_API_KEY');
  }

  try {
    // 获取最新财报
    const url = `${BASE_URL}/income-statement/${symbol}?limit=1&apikey=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const latest = data[0];

    return {
      symbol: latest.symbol,
      name: latest.symbol,
      quarter: `Q${latest.period} ${latest.calendarYear}`,
      date: latest.date,
      expectedEPS: latest.eps || 'N/A',
      actualEPS: latest.eps || 'N/A',
      expectedRevenue: latest.revenue ? (latest.revenue / 1000000).toFixed(1) + 'M' : 'N/A',
      actualRevenue: latest.revenue ? (latest.revenue / 1000000).toFixed(1) + 'M' : 'N/A',
      yoyGrowth: 'N/A', // 需要计算
      highlights: [
        `Revenue: ${latest.revenue ? (latest.revenue / 1000000).toFixed(1) + 'M' : 'N/A'}`,
        `Net Income: ${latest.netIncome ? (latest.netIncome / 1000000).toFixed(1) + 'M' : 'N/A'}`,
        `Gross Profit: ${latest.grossProfit ? (latest.grossProfit / 1000000).toFixed(1) + 'M' : 'N/A'}`
      ],
      guidance: '查看官方财报',
      afterHoursMove: 'N/A',
      currency: 'USD',
      isRealData: true,
      source: 'FMP'
    };
  } catch (error) {
    console.error('FMP API 错误:', error.message);
    return null;
  }
}

/**
 * 获取公司信息
 */
async function getCompanyInfo(symbol, market = 'us') {
  if (!API_KEY || API_KEY === 'YOUR_FMP_API_KEY_HERE') {
    throw new Error('FMP API Key 未配置，请设置环境变量 FMP_API_KEY');
  }

  try {
    // 获取公司资料
    const profileUrl = `${BASE_URL}/profile/${symbol}?apikey=${API_KEY}`;
    const response = await fetch(profileUrl);
    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const profile = data[0];

    // 获取下次财报日期
    const calendarUrl = `${BASE_URL}/earning_calendar/${symbol}?apikey=${API_KEY}`;
    const calendarResponse = await fetch(calendarUrl);
    const calendarData = await calendarResponse.json();

    const nextEarnings = calendarData && calendarData.length > 0 ? calendarData[0] : null;

    return {
      symbol: profile.symbol,
      name: profile.companyName || profile.symbol,
      sector: profile.sector,
      industry: profile.industry,
      market: 'us',
      marketName: profile.exchange,
      nextEarningsDate: nextEarnings ? nextEarnings.date : 'N/A',
      expectedEPS: nextEarnings ? nextEarnings.epsEstimated : 'N/A',
      expectedRevenue: nextEarnings && nextEarnings.revenueEstimated
        ? (nextEarnings.revenueEstimated / 1000000).toFixed(1) + 'M'
        : 'N/A',
      currency: profile.currency || 'USD',
      description: profile.description,
      website: profile.website,
      isRealData: true,
      source: 'FMP'
    };
  } catch (error) {
    console.error('FMP API 错误:', error.message);
    return null;
  }
}

module.exports = {
  getEarningsCalendar,
  getCompanyEarnings,
  getCompanyInfo
};
