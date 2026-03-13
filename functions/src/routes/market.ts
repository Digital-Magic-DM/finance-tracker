import { Router, Request, Response } from 'express';
import { yahooFinanceService } from '../services/yahoo-finance.service';

const router = Router();

const NIFTY_50_SYMBOL = '^NSEI';
const SENSEX_SYMBOL = '^BSESN';

// NIFTY 50 Stocks (Expanded list)
const NIFTY_50_STOCKS = [
  'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'BHARTIARTL.NS',
  'SBIN.NS', 'INFY.NS', 'LICI.NS', 'ITC.NS', 'HINDUNILVR.NS',
  'LT.NS', 'BAJFINANCE.NS', 'HCLTECH.NS', 'MARUTI.NS', 'SUNPHARMA.NS',
  'ADANIENT.NS', 'KOTAKBANK.NS', 'TITAN.NS', 'ONGC.NS', 'TATASTEEL.NS',
  'NTPC.NS', 'AXISBANK.NS', 'ADANIPORTS.NS', 'ASIANPAINT.NS', 'M&M.NS',
  'ULTRACEMCO.NS', 'BAJAJFINSV.NS', 'POWERGRID.NS', 'JSWSTEEL.NS', 'COALINDIA.NS',
  'GRASIM.NS', 'HINDALCO.NS', 'NESTLEIND.NS', 'TATACONSUM.NS', 'SBILIFE.NS',
  'TECHM.NS', 'INDUSINDBK.NS', 'BRITANNIA.NS', 'DRREDDY.NS', 'ADANIPOWER.NS',
  'TATAMOTORS.NS', 'CIPLA.NS', 'EICHERMOT.NS', 'BPCL.NS', 'DIVISLAB.NS',
  'APOLLOHOSP.NS', 'HDFCLIFE.NS', 'HEROMOTOCO.NS', 'BAJAJ-AUTO.NS', 'WIPRO.NS'
];

router.get('/nifty', async (req: Request, res: Response) => {
  try {
    const data = await yahooFinanceService.getQuotes([NIFTY_50_SYMBOL]);
    res.json(data.quoteResponse.result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch NIFTY index' });
  }
});

router.get('/sensex', async (req: Request, res: Response) => {
  try {
    const data = await yahooFinanceService.getQuotes([SENSEX_SYMBOL]);
    res.json(data.quoteResponse.result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SENSEX index' });
  }
});

router.get('/quotes', async (req: Request, res: Response) => {
  const symbolsQuery = req.query.symbols as string;
  if (!symbolsQuery) {
    return res.status(400).json({ error: 'Symbols parameter is required' });
  }

  const symbols = symbolsQuery.split(',');
  try {
    const results = await yahooFinanceService.getQuotesBatched(symbols);
    const combinedResults = results.flatMap(r => r.quoteResponse.result);
    res.json(combinedResults);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

router.get('/top-volume', async (req: Request, res: Response) => {
  try {
    const results = await yahooFinanceService.getQuotesBatched(NIFTY_50_STOCKS);
    const stocks = results.flatMap(r => r.quoteResponse.result);
    const sorted = stocks.sort((a, b) => b.regularMarketVolume - a.regularMarketVolume);
    res.json(sorted.slice(0, 10));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top volume stocks' });
  }
});

router.get('/top-gainers', async (req: Request, res: Response) => {
  try {
    const results = await yahooFinanceService.getQuotesBatched(NIFTY_50_STOCKS);
    const stocks = results.flatMap(r => r.quoteResponse.result);
    const sorted = stocks.sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
    res.json(sorted.slice(0, 10));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top gainers' });
  }
});

router.get('/top-losers', async (req: Request, res: Response) => {
  try {
    const results = await yahooFinanceService.getQuotesBatched(NIFTY_50_STOCKS);
    const stocks = results.flatMap(r => r.quoteResponse.result);
    const sorted = stocks.sort((a, b) => a.regularMarketChangePercent - b.regularMarketChangePercent);
    res.json(sorted.slice(0, 10));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top losers' });
  }
});

router.get('/chart/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const range = (req.query.range as string) || '1d';
  const interval = (req.query.interval as string) || '5m';
  try {
    const data = await (yahooFinanceService as any).getChart(symbol, range, interval);
    res.json(data.chart.result[0]);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch chart for ${symbol}` });
  }
});

export default router;
