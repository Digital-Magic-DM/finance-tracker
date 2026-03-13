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
        this.cache = new node_cache_1.default({ stdTTL: 60, checkperiod: 70 });
        this.limit = pLimit(5);
    }
    async getQuotes(symbols) {
        const symbolsKey = symbols.sort().join(',');
        const cachedData = this.cache.get(symbolsKey);
        if (cachedData) {
            return cachedData;
        }
        return this.limit(async () => {
            try {
                const response = await axios_1.default.get(this.QUOTE_URL, {
                    params: {
                        symbols: symbols.join(','),
                    },
                    timeout: 10000,
                });
                this.cache.set(symbolsKey, response.data);
                return response.data;
            }
            catch (error) {
                console.error(`Error fetching quotes for ${symbolsKey}:`, error);
                throw error;
            }
        });
    }
    async getChart(symbol, range = '1d', interval = '5m') {
        const cacheKey = `chart_${symbol}_${range}_${interval}`;
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }
        return this.limit(async () => {
            try {
                const response = await axios_1.default.get(`${this.CHART_URL}/${symbol}`, {
                    params: {
                        range,
                        interval,
                        includePrePost: false,
                    },
                    timeout: 10000,
                });
                this.cache.set(cacheKey, response.data);
                return response.data;
            }
            catch (error) {
                console.error(`Error fetching chart for ${symbol}:`, error);
                throw error;
            }
        });
    }
    async getQuotesBatched(symbols) {
        const batches = [];
        for (let i = 0; i < symbols.length; i += 50) {
            batches.push(symbols.slice(i, i + 50));
        }
        const promises = batches.map(batch => this.getQuotes(batch));
        return Promise.all(promises);
    }
}
exports.YahooFinanceService = YahooFinanceService;
exports.yahooFinanceService = new YahooFinanceService();
//# sourceMappingURL=yahoo-finance.service.js.map