import { Router, Request, Response } from 'express';
import { yahooFinanceService } from '../services/yahoo-finance.service';
import { nseService } from '../services/nse.service';
import { finnhubService } from '../services/finnhub.service';

const router = Router();

// NIFTY 50 Stocks
const NIFTY_50_STOCKS = [
  'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'BHARTIARTL.NS',
  'SBIN.NS', 'INFY.NS', 'LICI.NS', 'ITC.NS', 'HINDUNILVR.NS'
];

router.get('/nifty', async (_req: Request, res: Response) => {
  try {
    const data = await nseService.getNifty50();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch NIFTY index' });
  }
});

router.get('/sensex', async (_req: Request, res: Response) => {
  try {
    const data = await nseService.getSensex();
    res.json(data);
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
  const finnhubSymbols = symbols.filter(s => !s.endsWith('.NS') && !s.endsWith('.BO'));
  const yahooSymbols = symbols.filter(s => s.endsWith('.NS') || s.endsWith('.BO'));

  try {
    const [finnhubResults, yahooResults] = await Promise.all([
      finnhubSymbols.length > 0 ? finnhubService.getQuotesBatch(finnhubSymbols) : Promise.resolve([]),
      yahooSymbols.length > 0 ? yahooFinanceService.getQuotes(yahooSymbols) : Promise.resolve({ quoteResponse: { result: [] } })
    ]);

    const normalizedYahoo = (yahooResults as any).quoteResponse.result.map((quote: any) => ({
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      open: quote.regularMarketOpen,
      previousClose: quote.regularMarketPreviousClose,
      timestamp: Date.now(),
      source: 'yahoo'
    }));

    res.json([...finnhubResults, ...normalizedYahoo]);
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

router.get('/top-gainers', async (_req: Request, res: Response) => {
  try {
    const results = await yahooFinanceService.getTopMovers('day_gainers');
    res.json(results);
  } catch (error) {
    // Fallback to manual Nifty 50 sorting
    try {
      const results = await yahooFinanceService.getQuotesBatched(NIFTY_50_STOCKS);
      const stocks = results.flatMap(r => r.quoteResponse.result);
      const sorted = stocks.sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
      res.json(sorted.slice(0, 10));
    } catch (fallbackError) {
      res.status(500).json({ error: 'Failed to fetch top gainers' });
    }
  }
});

router.get('/top-losers', async (_req: Request, res: Response) => {
  try {
    const results = await yahooFinanceService.getTopMovers('day_losers');
    res.json(results);
  } catch (error) {
    // Fallback to manual Nifty 50 sorting
    try {
      const results = await yahooFinanceService.getQuotesBatched(NIFTY_50_STOCKS);
      const stocks = results.flatMap(r => r.quoteResponse.result);
      const sorted = stocks.sort((a, b) => a.regularMarketChangePercent - b.regularMarketChangePercent);
      res.json(sorted.slice(0, 10));
    } catch (fallbackError) {
      res.status(500).json({ error: 'Failed to fetch top losers' });
    }
  }
});

router.get('/chart/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol as string;
  const range = (req.query.range as string) || '1d';
  const interval = (req.query.interval as string) || '5m';
  
  const validRanges = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'];
  const validIntervals = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'];
  
  if (!validRanges.includes(range)) {
    return res.status(400).json({ error: 'Invalid range parameter' });
  }
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ error: 'Invalid interval parameter' });
  }

  try {
    const data = await yahooFinanceService.getChart(symbol, range, interval);
    res.json(data.chart.result[0]);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch chart for ${symbol}` });
  }
});

export default router;
