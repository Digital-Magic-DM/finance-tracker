
import NodeCache from 'node-cache';
const pLimit = require('p-limit');
import { yahooFinanceService } from './yahoo-finance.service';
import { NormalizedQuote } from '../types/market.types';

export class NSEService {
  private cache: NodeCache;
  private limit: any;

  private metrics = {
    hits: 0,
    misses: 0,
    swr: 0,
    refreshes: 0
  };

  constructor() {
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
    this.limit = pLimit(10);
  }

  private async withSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    freshTTL: number = 60
  ): Promise<T> {
    const cached = this.cache.get<{ data: T; timestamp: number }>(key);
    const now = Date.now();

    if (cached) {
      const age = (now - cached.timestamp) / 1000;
      if (age < freshTTL) {
        this.metrics.hits++;
        return cached.data;
      }

      this.metrics.swr++;
      this.refreshInBackground(key, fetcher);
      return cached.data;
    }

    this.metrics.misses++;
    return this.refreshInBackground(key, fetcher);
  }

  private async refreshInBackground<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return this.limit(async () => {
      try {
        const data = await fetcher();
        this.cache.set(key, { data, timestamp: Date.now() });
        this.metrics.refreshes++;
        return data;
      } catch (error) {
        console.error(`NSE Refresh failed for ${key}:`, error);
        const cached = this.cache.get<{ data: T }>(key);
        if (cached) return cached.data;
        throw error;
      }
    });
  }

  async getNifty50(): Promise<NormalizedQuote> {
    return this.getQuote('^NSEI');
  }

  async getSensex(): Promise<NormalizedQuote> {
    return this.getQuote('^BSESN');
  }

  private async getQuote(symbol: string): Promise<NormalizedQuote> {
    return this.withSWR(
      `nse_${symbol}`,
      async () => {
        const response = await yahooFinanceService.getQuotes([symbol]);
        const quote = response.quoteResponse.result[0];

        if (!quote) {
          throw new Error(`Quote not found for ${symbol}`);
        }

        const normalized: NormalizedQuote = {
          symbol: quote.symbol,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange,
          changePercent: quote.regularMarketChangePercent,
          high: quote.regularMarketDayHigh,
          low: quote.regularMarketDayLow,
          open: quote.regularMarketOpen,
          previousClose: quote.regularMarketPreviousClose,
          timestamp: Date.now(),
          source: 'nse',
        };

        return normalized;
      },
      60 // Fresh for 60 seconds
    );
  }

  getMetrics() {
    return {
      ...this.metrics,
      totalRequests: this.metrics.hits + this.metrics.swr + this.metrics.misses,
      hitRate: ((this.metrics.hits + this.metrics.swr) / (this.metrics.hits + this.metrics.swr + this.metrics.misses || 1) * 100).toFixed(2) + '%'
    };
  }
}

export const nseService = new NSEService();
