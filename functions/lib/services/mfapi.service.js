"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mfapiService = exports.MFAPIService = void 0;
const axios_1 = __importDefault(require("axios"));
const node_cache_1 = __importDefault(require("node-cache"));
const pLimit = require('p-limit');
class MFAPIService {
    constructor() {
        this.BASE_URL = 'https://api.mfapi.in/mf';
        this.metrics = {
            hits: 0,
            misses: 0,
            swr: 0,
            refreshes: 0
        };
        this.cache = new node_cache_1.default({ stdTTL: 86400, checkperiod: 3600 });
        this.limit = pLimit(5);
    }
    async withSWR(key, fetcher, freshTTL = 3600) {
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
                console.error(`MF Refresh failed for ${key}:`, error);
                const cached = this.cache.get(key);
                if (cached)
                    return cached.data;
                throw error;
            }
        });
    }
    async getNavBySchemeCode(schemeCode) {
        return this.withSWR(`mf_${schemeCode}`, async () => {
            const response = await axios_1.default.get(`${this.BASE_URL}/${schemeCode}`, {
                timeout: 10000,
            });
            const data = response.data;
            if (data.status !== 'SUCCESS' || data.data.length === 0) {
                throw new Error('Invalid scheme code or no data available');
            }
            const latest = data.data[0];
            const previous = data.data.length > 1 ? data.data[1] : latest;
            const normalized = {
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
        }, 3600);
    }
    getMetrics() {
        return {
            ...this.metrics,
            totalRequests: this.metrics.hits + this.metrics.swr + this.metrics.misses,
            hitRate: ((this.metrics.hits + this.metrics.swr) / (this.metrics.hits + this.metrics.swr + this.metrics.misses || 1) * 100).toFixed(2) + '%'
        };
    }
}
exports.MFAPIService = MFAPIService;
exports.mfapiService = new MFAPIService();
//# sourceMappingURL=mfapi.service.js.map