"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.yahooFinanceService = exports.YahooFinanceService = void 0;
const axios_1 = __importDefault(require("axios"));
const node_cache_1 = __importDefault(require("node-cache"));
const pLimit = require('p-limit');
class YahooFinanceService {
    constructor() {
        this.QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
        this.CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart';
        this.metrics = {
            hits: 0,
            misses: 0,
            swr: 0,
            refreshes: 0
        };
        this.cache = new node_cache_1.default({ stdTTL: 3600, checkperiod: 120 });
        this.limit = pLimit(10);
    }
    async withSWR(key, fetcher, freshTTL = 60) {
        const cached = this.cache.get(key);
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
    async refreshInBackground(key, fetcher) {
        return this.limit(async () => {
            try {
                const data = await fetcher();
                this.cache.set(key, { data, timestamp: Date.now() });
                this.metrics.refreshes++;
                return data;
            }
            catch (error) {
                console.error(`Refresh failed for ${key}:`, error);
                const cached = this.cache.get(key);
                if (cached)
                    return cached.data;
                throw error;
            }
        });
    }
    async getQuotes(symbols) {
        const symbolsKey = symbols.sort().join(',');
        return this.withSWR(`quotes_${symbolsKey}`, async () => {
            const response = await axios_1.default.get(this.QUOTE_URL, {
                params: { symbols: symbols.join(',') },
                timeout: 10000,
            });
            return response.data;
        }, 30);
    }
    async getChart(symbol, range = '1d', interval = '5m') {
        const cacheKey = `chart_${symbol}_${range}_${interval}`;
        return this.withSWR(cacheKey, async () => {
            const response = await axios_1.default.get(`${this.CHART_URL}/${symbol}`, {
                params: { range, interval, includePrePost: false },
                timeout: 10000,
            });
            return response.data;
        }, 300);
    }
    async getQuotesBatched(symbols) {
        const BATCH_SIZE = 50;
        const batches = [];
        for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            batches.push(symbols.slice(i, i + BATCH_SIZE));
        }
        const promises = batches.map(batch => this.getQuotes(batch));
        return Promise.all(promises);
    }
    async getTopMovers(type) {
        const cacheKey = `movers_${type}`;
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }
        return this.limit(async () => {
            try {
                const response = await axios_1.default.get(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved`, {
                    params: {
                        scrIds: type,
                        count: 10,
                    },
                    timeout: 10000,
                });
                const data = response.data;
                this.cache.set(cacheKey, data);
                return data;
            }
            catch (error) {
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
    async prefetchQuotes(symbols) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            const batch = symbols.slice(i, i + BATCH_SIZE);
            const key = `quotes_${batch.sort().join(',')}`;
            this.refreshInBackground(key, async () => {
                const response = await axios_1.default.get(this.QUOTE_URL, {
                    params: { symbols: batch.join(',') },
                    timeout: 10000,
                });
                return response.data;
            });
        }
    }
}
exports.YahooFinanceService = YahooFinanceService;
exports.yahooFinanceService = new YahooFinanceService();
//# sourceMappingURL=yahoo-finance.service.js.map