# 🏆 DR Analyzer — Indian Stock Intelligence Platform

A premium, full-stack stock analysis application for Indian markets.  
Uses **100% free APIs** — no paid data services required.

---

## ✨ Features

- 🔴 **Live market data** via Yahoo Finance (free, no key required)
- 📊 **Full fundamental analysis**: Revenue, Profits, Margins, Ratios, Balance Sheet, Cash Flow
- 📈 **Interactive price charts** with 1M → 5Y range controls
- 🎯 **Analyst targets** & consensus recommendations  
- 📰 **Latest news** for each stock
- ⚡ **Risk analysis** — dynamically generated from financials
- 🏷️ **Investment verdict**: BUY / HOLD / AVOID with score
- 🔍 **Autocomplete search** for any NSE/BSE stock
- 🌙/☀️ **Dark/Light theme** toggle
- 🔒 **Secure** — API keys stored on backend only

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. (Optional) Add free API keys

```bash
cp .env.example .env
# Edit .env and add your free API keys
```

**Free API keys you can get:**
- **Yahoo Finance** — No key needed! (primary source)
- **Alpha Vantage** — https://www.alphavantage.co/support/#api-key (free, 25 calls/day)
- **Financial Modeling Prep** — https://financialmodelingprep.com (free, 250 calls/day)

### 3. Start the server

```bash
cd backend
node server.js
```

### 4. Open in browser

```
http://localhost:3000
```

---

## 📁 Project Structure

```
dr-analyzer/
├── backend/
│   ├── server.js       ← Express server (API proxy + serves frontend)
│   ├── .env.example    ← Environment variable template
│   └── package.json
└── frontend/
    └── index.html      ← Complete single-page UI
```

---

## 🔌 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stock/:symbol` | Full fundamental data for a stock |
| `GET /api/chart/:symbol?range=1y` | Historical price data for charts |
| `GET /api/news/:symbol` | Latest news articles |
| `GET /api/search?q=query` | Autocomplete search |
| `GET /api/trending` | Popular Indian stocks ticker |

---

## 📊 Supported Symbols

Any **NSE** or **BSE** listed stock. Just type the symbol without suffix:
- `RELIANCE` → auto-maps to `RELIANCE.NS`
- `TCS`, `HDFCBANK`, `INFY`, `ICICIBANK`, `SBIN`
- For BSE: use `SYMBOL.BO` (e.g. `RELIANCE.BO`)

---

## 🔒 Security Notes

- All API keys are stored in `.env` on the backend only
- The frontend never sees API keys
- Rate limiting: 30 requests/minute per IP
- `.env` is gitignored by default

---

## ⚠️ Disclaimer

Not financial advice. For educational purposes only.  
Data sourced from Yahoo Finance public APIs. May be delayed 15 minutes.  
Always consult a SEBI-registered advisor before investing.
