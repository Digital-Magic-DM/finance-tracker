"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nseService = exports.NSEService = void 0;
const node_cache_1 = __importDefault(require("node-cache"));
const pLimit = require('p-limit');
const yahoo_finance_service_1 = require("./yahoo-finance.service");
class NSEService {
    constructor() {
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
                console.error(`NSE Refresh failed for ${key}:`, error);
                const cached = this.cache.get(key);
                if (cached)
                    return cached.data;
                throw error;
            }
        });
    }
    async getNifty50() {
        return this.getQuote('^NSEI');
    }
    async getSensex() {
        return this.getQuote('^BSESN');
    }
    async getQuote(symbol) {
        return this.withSWR(`nse_${symbol}`, async () => {
            const response = await yahoo_finance_service_1.yahooFinanceService.getQuotes([symbol]);
            const quote = response.quoteResponse.result[0];
            if (!quote) {
                throw new Error(`Quote not found for ${symbol}`);
            }
            const normalized = {
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
        }, 60);
    }
    getMetrics() {
        return {
            ...this.metrics,
            totalRequests: this.metrics.hits + this.metrics.swr + this.metrics.misses,
            hitRate: ((this.metrics.hits + this.metrics.swr) / (this.metrics.hits + this.metrics.swr + this.metrics.misses || 1) * 100).toFixed(2) + '%'
        };
    }
}
exports.NSEService = NSEService;
exports.nseService = new NSEService();
//# sourceMappingURL=nse.service.js.map