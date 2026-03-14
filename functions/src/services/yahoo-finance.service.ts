import axios from 'axios';
import NodeCache from 'node-cache';
const pLimit = require('p-limit');
import { YahooQuoteResponse, YahooChartResponse } from '../types/market.types';

export class YahooFinanceService {
  private cache: NodeCache;
  private limit: any;
  private readonly QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
  private readonly CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';

  // Metrics
  private metrics = {
    hits: 0,
    misses: 0,
    swr: 0,
    refreshes: 0
  };

  constructor() {
    // Cache for 1 hour (as fallback/stale data), check every 2 minutes
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
    // Limit to 10 concurrent requests (increased from 5)
    this.limit = pLimit(10);
  }

  private async withSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    freshTTL: number = 60 // Fresh for 60 seconds
  ): Promise<T> {
    const cached = this.cache.get<{ data: T; timestamp: number }>(key);
    const now = Date.now();

    if (cached) {
      const age = (now - cached.timestamp) / 1000;
      if (age < freshTTL) {
        this.metrics.hits++;
        return cached.data;
      }

      // Stale-While-Revalidate
      this.metrics.swr++;
      // Trigger background refresh
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
        console.error(`Refresh failed for ${key}:`, error);
        // If background refresh fails, we still have the stale data in cache (if called from SWR)
        // If called from MISS, we must throw
        const cached = this.cache.get<{ data: T }>(key);
        if (cached) return cached.data;
        throw error;
      }
    });
  }

  async getQuotes(symbols: string[]): Promise<YahooQuoteResponse> {
    const symbolsKey = symbols.sort().join(',');
    return this.withSWR(
      `quotes_${symbolsKey}`,
      async () => {
        const response = await axios.get<YahooQuoteResponse>(this.QUOTE_URL, {
          params: { symbols: symbols.join(',') },
          timeout: 10000,
        });
        return response.data;
      },
      30 // Quotes are fresh for 30 seconds
    );
  }

  async getChart(symbol: string, range: string = '1d', interval: string = '5m'): Promise<YahooChartResponse> {
    const cacheKey = `chart_${symbol}_${range}_${interval}`;
    return this.withSWR(
      cacheKey,
      async () => {
        const response = await axios.get<YahooChartResponse>(`${this.CHART_URL}/${symbol}`, {
          params: { range, interval, includePrePost: false },
          timeout: 10000,
        });
        return response.data;
      },
      300 // Charts fresh for 5 minutes
    );
  }

  async getQuotesBatched(symbols: string[]): Promise<YahooQuoteResponse[]> {
    const BATCH_SIZE = 50;
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      batches.push(symbols.slice(i, i + BATCH_SIZE));
    }

    const promises = batches.map(batch => this.getQuotes(batch));
    return Promise.all(promises);
  }

  async getTopMovers(type: 'day_gainers' | 'day_losers'): Promise<any> {
    const cacheKey = `movers_${type}`;
    const cachedData = this.cache.get<any>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    return this.limit(async () => {
      try {
        const response = await axios.get(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved`, {
          params: {
            scrIds: type,
            count: 10,
          },
          timeout: 10000,
        });

        const data = response.data;
        this.cache.set(cacheKey, data);
        return data;
      } catch (error) {
        console.error(`Error fetching top movers ${type}:`, error);
        throw error;
      }
    });
  }

  getMetrics() {
    return {
      ...this.metrics,
      totalRequests: this.metrics.hits + this.metrics.swr + this.metrics.misses,
      hitRate: ((this.metrics.hits + this.metrics.swr) / (this.metrics.hits + this.metrics.swr + this.metrics.misses || 1) * 100).toFixed(2) + '%'
    };
  }

  // Manually trigger background refresh for a list of symbols
  async prefetchQuotes(symbols: string[]) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const key = `quotes_${batch.sort().join(',')}`;
      this.refreshInBackground(key, async () => {
        const response = await axios.get<YahooQuoteResponse>(this.QUOTE_URL, {
          params: { symbols: batch.join(',') },
          timeout: 10000,
        });
        return response.data;
      });
    }
  }
}

export const yahooFinanceService = new YahooFinanceService();
