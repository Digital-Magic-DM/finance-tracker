import axios from 'axios';
import NodeCache from 'node-cache';
const pLimit = require('p-limit');
import { YahooQuoteResponse, YahooChartResponse } from '../types/market.types';

export class YahooFinanceService {
  private cache: NodeCache;
  private limit: any;
  private readonly QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
  private readonly CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';

  constructor() {
    // Cache for 60 seconds
    this.cache = new NodeCache({ stdTTL: 60, checkperiod: 70 });
    // Limit to 5 concurrent requests
    this.limit = pLimit(5);
  }

  async getQuotes(symbols: string[]): Promise<YahooQuoteResponse> {
    const symbolsKey = symbols.sort().join(',');
    const cachedData = this.cache.get<YahooQuoteResponse>(symbolsKey);

    if (cachedData) {
      return cachedData;
    }

    return this.limit(async () => {
      try {
        const response = await axios.get<YahooQuoteResponse>(this.QUOTE_URL, {
          params: {
            symbols: symbols.join(','),
          },
          timeout: 10000,
        });

        this.cache.set(symbolsKey, response.data);
        return response.data;
      } catch (error) {
        console.error(`Error fetching quotes for ${symbolsKey}:`, error);
        throw error;
      }
    });
  }

  async getChart(symbol: string, range: any = '1d', interval: any = '5m'): Promise<YahooChartResponse> {
    const cacheKey = `chart_${symbol}_${range}_${interval}`;
    const cachedData = this.cache.get<YahooChartResponse>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    return this.limit(async () => {
      try {
        const response = await axios.get<YahooChartResponse>(`${this.CHART_URL}/${symbol}`, {
          params: {
            range,
            interval,
            includePrePost: false,
          },
          timeout: 10000,
        });

        this.cache.set(cacheKey, response.data);
        return response.data;
      } catch (error) {
        console.error(`Error fetching chart for ${symbol}:`, error);
        throw error;
      }
    });
  }

  // Helper for batching symbols (max 50 as per requirement)
  async getQuotesBatched(symbols: string[]): Promise<YahooQuoteResponse[]> {
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += 50) {
      batches.push(symbols.slice(i, i + 50));
    }

    const promises = batches.map(batch => this.getQuotes(batch));
    return Promise.all(promises);
  }
}

export const yahooFinanceService = new YahooFinanceService();
