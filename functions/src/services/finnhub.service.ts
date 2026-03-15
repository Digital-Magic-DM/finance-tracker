import axios from 'axios';
import NodeCache from 'node-cache';
const pLimit = require('p-limit');
import { FinnhubQuote, NormalizedQuote } from '../types/market.types';

export class FinnhubService {
  private cache: NodeCache;
  private limit: any;
  private readonly BASE_URL = 'https://finnhub.io/api/v1';
  private readonly API_KEY = process.env.FINNHUB_API_KEY;

  private metrics = {
    hits: 0,
    misses: 0,
    swr: 0,
    refreshes: 0
  };

  constructor() {
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
    this.limit = pLimit(5);
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
        console.error(`Finnhub Refresh failed for ${key}:`, error);
        const cached = this.cache.get<{ data: T }>(key);
        if (cached) return cached.data;
        throw error;
      }
    });
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    const upperSymbol = symbol.toUpperCase();
    return this.withSWR(
      `fh_${upperSymbol}`,
      async () => {
        const response = await axios.get<FinnhubQuote>(`${this.BASE_URL}/quote`, {
          params: {
            symbol: upperSymbol,
            token: this.API_KEY,
          },
          timeout: 10000,
        });

        const data = response.data;
        const normalized: NormalizedQuote = {
          symbol: upperSymbol,
          price: data.c,
          change: data.d,
          changePercent: data.dp,
          high: data.h,
          low: data.l,
          open: data.o,
          previousClose: data.pc,
          timestamp: data.t * 1000,
          source: 'finnhub',
        };

        return normalized;
      },
      60 // Fresh for 60 seconds
    );
  }

  async getQuotesBatch(symbols: string[]): Promise<NormalizedQuote[]> {
    const promises = symbols.map(symbol => this.getQuote(symbol));
    return Promise.all(promises);
  }

  getMetrics() {
    return {
      ...this.metrics,
      totalRequests: this.metrics.hits + this.metrics.swr + this.metrics.misses,
      hitRate: ((this.metrics.hits + this.metrics.swr) / (this.metrics.hits + this.metrics.swr + this.metrics.misses || 1) * 100).toFixed(2) + '%'
    };
  }
}

export const finnhubService = new FinnhubService();
