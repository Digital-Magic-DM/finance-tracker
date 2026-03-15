import axios from 'axios';
import NodeCache from 'node-cache';
const pLimit = require('p-limit');
import { MFNavResponse, NormalizedQuote } from '../types/market.types';

export class MFAPIService {
  private cache: NodeCache;
  private limit: any;
  private readonly BASE_URL = 'https://api.mfapi.in/mf';

  private metrics = {
    hits: 0,
    misses: 0,
    swr: 0,
    refreshes: 0
  };

  constructor() {
    // MF data changes daily, so we can cache for a long time as stale
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
    this.limit = pLimit(5);
  }

  private async withSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    freshTTL: number = 3600 // Fresh for 1 hour
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
        console.error(`MF Refresh failed for ${key}:`, error);
        const cached = this.cache.get<{ data: T }>(key);
        if (cached) return cached.data;
        throw error;
      }
    });
  }

  async getNavBySchemeCode(schemeCode: string): Promise<NormalizedQuote> {
    return this.withSWR(
      `mf_${schemeCode}`,
      async () => {
        const response = await axios.get<MFNavResponse>(`${this.BASE_URL}/${schemeCode}`, {
          timeout: 10000,
        });

        const data = response.data;
        if (data.status !== 'SUCCESS' || data.data.length === 0) {
          throw new Error('Invalid scheme code or no data available');
        }

        const latest = data.data[0];
        const previous = data.data.length > 1 ? data.data[1] : latest;

        const normalized: NormalizedQuote = {
          symbol: schemeCode,
          price: parseFloat(latest.nav),
          change: parseFloat(latest.nav) - parseFloat(previous.nav),
          changePercent: ((parseFloat(latest.nav) - parseFloat(previous.nav)) / parseFloat(previous.nav)) * 100,
          high: parseFloat(latest.nav),
          low: parseFloat(latest.nav),
          open: parseFloat(latest.nav),
          previousClose: parseFloat(previous.nav),
          timestamp: new Date(latest.date.split('-').reverse().join('-')).getTime(),
          source: 'mfapi',
        };

        return normalized;
      },
      3600 // Fresh for 1 hour
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

export const mfapiService = new MFAPIService();
