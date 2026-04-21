require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', limiter);

// ─── Yahoo crumb cache (required since 2024) ──────────────────────────────────
let _crumb = null, _cookie = null;

async function getYahooCrumb() {
  if (_crumb && _cookie) return { crumb: _crumb, cookie: _cookie };
  try {
    const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    const raw = r1.headers.raw()['set-cookie'] || [];
    _cookie = raw.map(c => c.split(';')[0]).join('; ');
    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': _cookie }
    });
    _crumb = await r2.text();
    if (!_crumb || _crumb.includes('<')) { _crumb = null; _cookie = null; }
  } catch (e) { _crumb = null; _cookie = null; }
  return { crumb: _crumb, cookie: _cookie };
}

function yHeaders(cookie) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    ...(cookie ? { 'Cookie': cookie } : {})
  };
}

// ─── Helper: NSE/BSE symbol normalizer ────────────────────────────────────────
function toYahooSymbol(sym) {
  const s = sym.trim().toUpperCase();
  if (!s.includes('.')) return `${s}.NS`;
  return s;
}

// ─── Route: Fetch stock data from Yahoo Finance ───────────────────────────────
app.get('/api/stock/:symbol', async (req, res) => {
  const raw = req.params.symbol;
  const symbol = toYahooSymbol(raw);

  try {
    const { crumb, cookie } = await getYahooCrumb();
    const hdrs = yHeaders(cookie);
    const cp = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
    const MODS = 'price,summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistory,balanceSheetHistoryQuarterly,cashflowStatementHistoryQuarterly,majorHoldersBreakdown,recommendationTrend';
    const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d${cp}`;
    const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${MODS}${cp}`;

    const [quoteResp, summaryResp] = await Promise.all([
      fetch(quoteUrl, { headers: hdrs }),
      fetch(summaryUrl, { headers: hdrs })
    ]);

    if (!quoteResp.ok) { _crumb = null; _cookie = null; throw new Error(`Symbol not found (HTTP ${quoteResp.status})`); }

    const quoteData = await quoteResp.json();
    const summaryData = summaryResp.ok ? await summaryResp.json() : null;
    if (summaryData?.quoteSummary?.error) { _crumb = null; _cookie = null; }

    const chartMeta = quoteData?.chart?.result?.[0]?.meta;
    if (!chartMeta) throw new Error('No data for symbol');

    const modules = summaryData?.quoteSummary?.result?.[0] || {};
    const price = modules.price || {};
    const summary = modules.summaryDetail || {};
    const keyStats = modules.defaultKeyStatistics || {};
    const financialData = modules.financialData || {};
    const incomeStmt = modules.incomeStatementHistory?.incomeStatementHistory || [];
    const balanceSheet = modules.balanceSheetHistory?.balanceSheetStatements || [];
    const cashflow = modules.cashflowStatementHistory?.cashflowStatements || [];
    const holders = modules.majorHoldersBreakdown || {};
    const recommendations = modules.recommendationTrend?.trend || [];

    // Build clean response
    const response = {
      symbol: symbol,
      name: price.longName || price.shortName || raw.toUpperCase(),
      sector: price.sector || 'N/A',
      industry: price.industry || 'N/A',
      exchange: price.exchangeName || 'NSE',
      currency: price.currency || 'INR',

      // Snapshot
      currentPrice: price.regularMarketPrice?.raw || chartMeta.regularMarketPrice || 0,
      previousClose: price.regularMarketPreviousClose?.raw || 0,
      open: price.regularMarketOpen?.raw || 0,
      dayHigh: price.regularMarketDayHigh?.raw || 0,
      dayLow: price.regularMarketDayLow?.raw || 0,
      week52High: summary.fiftyTwoWeekHigh?.raw || keyStats.fiftyTwoWeekHigh?.raw || 0,
      week52Low: summary.fiftyTwoWeekLow?.raw || keyStats.fiftyTwoWeekLow?.raw || 0,
      volume: price.regularMarketVolume?.raw || 0,
      avgVolume: price.averageDailyVolume10Day?.raw || 0,
      marketCap: price.marketCap?.raw || 0,
      marketCapFmt: price.marketCap?.fmt || 'N/A',
      changePercent: price.regularMarketChangePercent?.raw || 0,
      change: price.regularMarketChange?.raw || 0,

      // Valuation
      peRatio: summary.trailingPE?.raw || keyStats.forwardPE?.raw || null,
      forwardPE: keyStats.forwardPE?.raw || null,
      pbRatio: keyStats.priceToBook?.raw || null,
      pegRatio: keyStats.pegRatio?.raw || null,
      evToEbitda: keyStats.enterpriseToEbitda?.raw || null,
      evToRevenue: keyStats.enterpriseToRevenue?.raw || null,
      priceToSales: summary.priceToSalesTrailing12Months?.raw || null,
      enterpriseValue: keyStats.enterpriseValue?.raw || null,

      // Dividends
      dividendYield: summary.dividendYield?.raw ? (summary.dividendYield.raw * 100) : null,
      dividendRate: summary.dividendRate?.raw || null,
      payoutRatio: summary.payoutRatio?.raw ? (summary.payoutRatio.raw * 100) : null,
      exDividendDate: summary.exDividendDate?.fmt || null,

      // Key Stats
      eps: keyStats.trailingEps?.raw || null,
      forwardEps: keyStats.forwardEps?.raw || null,
      bookValue: keyStats.bookValue?.raw || null,
      beta: keyStats.beta?.raw || summary.beta?.raw || null,
      sharesOutstanding: keyStats.sharesOutstanding?.raw || null,
      floatShares: keyStats.floatShares?.raw || null,
      shortRatio: keyStats.shortRatio?.raw || null,

      // Financial Ratios
      roe: financialData.returnOnEquity?.raw ? (financialData.returnOnEquity.raw * 100) : null,
      roa: financialData.returnOnAssets?.raw ? (financialData.returnOnAssets.raw * 100) : null,
      profitMargin: financialData.profitMargins?.raw ? (financialData.profitMargins.raw * 100) : null,
      grossMargin: financialData.grossMargins?.raw ? (financialData.grossMargins.raw * 100) : null,
      operatingMargin: financialData.operatingMargins?.raw ? (financialData.operatingMargins.raw * 100) : null,
      ebitdaMargin: financialData.ebitdaMargins?.raw ? (financialData.ebitdaMargins.raw * 100) : null,
      revenueGrowth: financialData.revenueGrowth?.raw ? (financialData.revenueGrowth.raw * 100) : null,
      earningsGrowth: financialData.earningsGrowth?.raw ? (financialData.earningsGrowth.raw * 100) : null,

      // Debt
      totalDebt: financialData.totalDebt?.raw || null,
      totalCash: financialData.totalCash?.raw || null,
      debtToEquity: financialData.debtToEquity?.raw || null,
      currentRatio: financialData.currentRatio?.raw || null,
      quickRatio: financialData.quickRatio?.raw || null,

      // Revenue/Earnings current
      totalRevenue: financialData.totalRevenue?.raw || null,
      revenuePerShare: financialData.revenuePerShare?.raw || null,
      freeCashflow: financialData.freeCashflow?.raw || null,
      operatingCashflow: financialData.operatingCashflow?.raw || null,

      // Ownership
      promoterHolding: null, // Not in Yahoo, will compute
      institutionalHolding: holders.institutionsPercentHeld?.raw ? (holders.institutionsPercentHeld.raw * 100) : null,
      insiderHolding: holders.insidersPercentHeld?.raw ? (holders.insidersPercentHeld.raw * 100) : null,

      // Historical Income Statements (up to 4 years)
      incomeHistory: incomeStmt.map(s => ({
        date: s.endDate?.fmt || '',
        revenue: s.totalRevenue?.raw || 0,
        grossProfit: s.grossProfit?.raw || 0,
        operatingIncome: s.operatingIncome?.raw || 0,
        netIncome: s.netIncome?.raw || 0,
        ebit: s.ebit?.raw || 0,
        ebitda: s.ebitda?.raw || 0,
        eps: s.basicEPS?.raw || 0,
      })).reverse(),

      // Historical Balance Sheet
      balanceHistory: balanceSheet.map(s => ({
        date: s.endDate?.fmt || '',
        totalAssets: s.totalAssets?.raw || 0,
        totalLiab: s.totalLiab?.raw || 0,
        totalStockholderEquity: s.totalStockholderEquity?.raw || 0,
        cash: s.cash?.raw || 0,
        totalDebt: (s.shortLongTermDebt?.raw || 0) + (s.longTermDebt?.raw || 0),
        netTangibleAssets: s.netTangibleAssets?.raw || 0,
      })).reverse(),

      // Historical Cash Flow
      cashflowHistory: cashflow.map(s => ({
        date: s.endDate?.fmt || '',
        operatingCF: s.totalCashFromOperatingActivities?.raw || 0,
        investingCF: s.totalCashflowsFromInvestingActivities?.raw || 0,
        financingCF: s.totalCashFromFinancingActivities?.raw || 0,
        capex: s.capitalExpenditures?.raw || 0,
        freeCF: (s.totalCashFromOperatingActivities?.raw || 0) + (s.capitalExpenditures?.raw || 0),
        depreciation: s.depreciation?.raw || 0,
      })).reverse(),

      // Analyst recommendations
      recommendations: recommendations.slice(0, 3).map(r => ({
        period: r.period,
        strongBuy: r.strongBuy,
        buy: r.buy,
        hold: r.hold,
        sell: r.sell,
        strongSell: r.strongSell,
      })),

      analystRating: financialData.recommendationKey || null,
      targetMeanPrice: financialData.targetMeanPrice?.raw || null,
      targetHighPrice: financialData.targetHighPrice?.raw || null,
      targetLowPrice: financialData.targetLowPrice?.raw || null,
      numberOfAnalysts: financialData.numberOfAnalystOpinions?.raw || null,
    };

    res.json({ success: true, data: response });

  } catch (err) {
    console.error('Stock fetch error:', err.message);
    // Try BSE suffix fallback
    if (!raw.includes('.') && !symbol.includes('.BO')) {
      return res.status(404).json({
        success: false,
        error: `Could not find stock "${raw}". Try using BSE symbol (e.g., ${raw}.BO) or verify the NSE symbol.`
      });
    }
    res.status(404).json({ success: false, error: `Stock not found: ${raw}` });
  }
});

// ─── Route: Fetch price history chart data ────────────────────────────────────
app.get('/api/chart/:symbol', async (req, res) => {
  const symbol = toYahooSymbol(req.params.symbol);
  const range = req.query.range || '1y';
  const intervalMap = { '1mo': '1d', '3mo': '1d', '6mo': '1wk', '1y': '1wk', '3y': '1mo', '5y': '1mo' };
  const interval = intervalMap[range] || '1wk';

  try {
    const { crumb: crumb2, cookie: cookie2 } = await getYahooCrumb();
    const cp2 = crumb2 ? `&crumb=${encodeURIComponent(crumb2)}` : '';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}${cp2}`;
    const resp = await fetch(url, { headers: yHeaders(cookie2) });
    const data = await resp.json();

    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No chart data');

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];

    const points = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i] ? parseFloat(closes[i].toFixed(2)) : null,
      volume: volumes[i] || 0,
    })).filter(p => p.close !== null);

    res.json({ success: true, data: points });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Route: Fetch news (using Yahoo Finance) ──────────────────────────────────
app.get('/api/news/:symbol', async (req, res) => {
  const symbol = toYahooSymbol(req.params.symbol);
  try {
    const { cookie: nc } = await getYahooCrumb();
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=8&quotesCount=0`;
    const resp = await fetch(url, { headers: yHeaders(nc) });
    const data = await resp.json();
    const news = (data?.news || []).slice(0, 6).map(n => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toLocaleDateString('en-IN') : '',
      thumbnail: n.thumbnail?.resolutions?.[0]?.url || null,
    }));
    res.json({ success: true, data: news });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Route: Search autocomplete ───────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json({ success: true, data: [] });
  try {
    const { cookie: sc } = await getYahooCrumb();
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableNavLinks=false&enableCb=false`;
    const resp = await fetch(url, { headers: yHeaders(sc) });
    const data = await resp.json();
    const quotes = (data?.quotes || [])
      .filter(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.quoteType === 'EQUITY')
      .slice(0, 6)
      .map(q => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType,
      }));
    res.json({ success: true, data: quotes });
  } catch (err) {
    res.status(500).json({ success: false, data: [] });
  }
});

// ─── Route: Trending Indian stocks ────────────────────────────────────────────
app.get('/api/trending', async (req, res) => {
  const popularStocks = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
    'HINDUNILVR.NS', 'SBIN.NS', 'BAJFINANCE.NS', 'ADANIENT.NS', 'WIPRO.NS'
  ];
  try {
    const symbols = popularStocks.join(',');
    const { crumb: tc, cookie: tck } = await getYahooCrumb();
    const tcp = tc ? `&crumb=${encodeURIComponent(tc)}` : '';
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,regularMarketPrice,regularMarketChangePercent,shortName${tcp}`;
    const resp = await fetch(url, { headers: yHeaders(tck) });
    const data = await resp.json();
    const quotes = data?.quoteResponse?.result || [];
    const trending = quotes.map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChangePercent,
    }));
    res.json({ success: true, data: trending });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// ─── Catch-all: serve frontend ─────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 DR Analyzer Backend running at http://localhost:${PORT}\n`);
});
