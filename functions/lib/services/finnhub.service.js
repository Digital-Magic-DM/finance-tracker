"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finnhubService = exports.FinnhubService = void 0;
const axios_1 = __importDefault(require("axios"));
const node_cache_1 = __importDefault(require("node-cache"));
const pLimit = require('p-limit');
class FinnhubService {
    constructor() {
        this.BASE_URL = 'https://finnhub.io/api/v1';
        this.API_KEY = process.env.FINNHUB_API_KEY;
        this.metrics = {
            hits: 0,
            misses: 0,
            swr: 0,
            refreshes: 0
        };
        this.cache = new node_cache_1.default({ stdTTL: 3600, checkperiod: 120 });
        this.limit = pLimit(5);
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
                console.error(`Finnhub Refresh failed for ${key}:`, error);
                const cached = this.cache.get(key);
                if (cached)
                    return cached.data;
                throw error;
            }
        });
    }
    async getQuote(symbol) {
        const upperSymbol = symbol.toUpperCase();
        return this.withSWR(`fh_${upperSymbol}`, async () => {
            const response = await axios_1.default.get(`${this.BASE_URL}/quote`, {
                params: {
                    symbol: upperSymbol,
                    token: this.API_KEY,
                },
                timeout: 10000,
            });
            const data = response.data;
            const normalized = {
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
        }, 60);
    }
    async getQuotesBatch(symbols) {
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
exports.FinnhubService = FinnhubService;
exports.finnhubService = new FinnhubService();
//# sourceMappingURL=finnhub.service.js.map