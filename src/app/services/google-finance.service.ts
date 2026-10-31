import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface GoogleFinanceQuote {
    ticker: string;
    price: number;
    change: number;
    changePercent: number;
    prevClose: number;
    name: string;
    status: 'SUCCESS' | 'NOT_FOUND' | 'ERROR';
    error?: string;
}

export interface GoogleFinanceResponse {
    success: boolean;
    timestamp: string;
    data?: Record<string, GoogleFinanceQuote>;
    error?: string;
}

export const DEFAULT_GOOGLE_FINANCE_URL = 'https://script.google.com/macros/s/AKfycbxD6Ep_0BMSudMREALfMWeyPLsZztXH232Cr0d5IHFHo6xuFqbNH6rkpD5Qd_rXUlLlzA/exec';

@Injectable({
    providedIn: 'root'
})
export class GoogleFinanceService {
    private http = inject(HttpClient);
    private readonly STORAGE_KEY = 'fintracker_google_finance_url';
    private readonly USD_RATE_KEY = 'fintracker_usd_to_inr';
    private readonly USD_RATE_TIME_KEY = 'fintracker_usd_to_inr_time';
    private readonly USD_RATE_TTL_MS = 60 * 60 * 1000; // 1 hour (3,600,000 ms)
    private pendingRateFetch: Promise<number> | null = null;

    apiUrl = signal<string>(this.getEffectiveUrl());
    isConfigured = signal<boolean>(true);
    isCustom = signal<boolean>(this.hasCustomUrl());
    usdToInrRate = signal<number>(this.getInitialUsdRate());

    // In-memory quote cache with 60-second TTL
    private cache = new Map<string, { quote: GoogleFinanceQuote; time: number }>();
    private readonly CACHE_TTL_MS = 60 * 1000;

    constructor() {
        // Automatically detect and update live USD/INR exchange rate on service init
        this.fetchUsdInrRate().catch(() => {});
    }

    private getInitialUsdRate(): number {
        try {
            const saved = localStorage.getItem(this.USD_RATE_KEY);
            if (saved && !isNaN(Number(saved)) && Number(saved) > 50) {
                return Number(saved);
            }
        } catch {}
        return 87.5;
    }

    /**
     * Automatically detects the live USD/INR exchange rate using Google Finance
     * (via CURRENCY:USDINR) or free open exchange rate APIs as fallback.
     * Caches in localStorage for 1 hour. Pass force=true to bypass cache (e.g. manual user refresh).
     */
    async fetchUsdInrRate(force: boolean = false): Promise<number> {
        // 0. Cache check: If not forced and last updated < 1 hour ago, use cached rate immediately
        if (!force) {
            try {
                const lastTime = Number(localStorage.getItem(this.USD_RATE_TIME_KEY) || 0);
                const currentRate = this.usdToInrRate();
                const now = Date.now();
                if (lastTime > 0 && (now - lastTime) < this.USD_RATE_TTL_MS && currentRate > 50) {
                    return currentRate;
                }
            } catch {}
        }

        // Deduplicate simultaneous requests
        if (this.pendingRateFetch) {
            return this.pendingRateFetch;
        }

        this.pendingRateFetch = this.executeFetchUsdInrRate()
            .finally(() => {
                this.pendingRateFetch = null;
            });

        return this.pendingRateFetch;
    }

    private async executeFetchUsdInrRate(): Promise<number> {
        // 1. Try Google Finance Apps Script Web App (CURRENCY:USDINR)
        try {
            const endpoint = this.apiUrl();
            if (endpoint) {
                const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}tickers=CURRENCY:USDINR`;
                const res = await firstValueFrom(this.http.get<GoogleFinanceResponse>(url));
                const quote = res?.data?.['CURRENCY:USDINR'] || res?.data?.['USDINR'];
                if (quote && quote.status === 'SUCCESS' && typeof quote.price === 'number' && quote.price > 50) {
                    this.updateUsdRate(quote.price);
                    return quote.price;
                }
            }
        } catch (err) {}

        // 2. Try Open Exchange Rates public endpoint (free, real-time, CORS-enabled)
        try {
            const res: any = await firstValueFrom(this.http.get('https://open.er-api.com/v6/latest/USD'));
            if (res && res.rates && typeof res.rates.INR === 'number' && res.rates.INR > 50) {
                this.updateUsdRate(res.rates.INR);
                return res.rates.INR;
            }
        } catch (err) {}

        // 3. Try Frankfurter API
        try {
            const res: any = await firstValueFrom(this.http.get('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR'));
            if (res && res.rates && typeof res.rates.INR === 'number' && res.rates.INR > 50) {
                this.updateUsdRate(res.rates.INR);
                return res.rates.INR;
            }
        } catch (err) {}

        return this.usdToInrRate();
    }

    private updateUsdRate(rate: number) {
        const rounded = Math.round(rate * 100) / 100;
        this.usdToInrRate.set(rounded);
        try {
            localStorage.setItem(this.USD_RATE_KEY, String(rounded));
            localStorage.setItem(this.USD_RATE_TIME_KEY, String(Date.now()));
        } catch {}
    }

    hasCustomUrl(): boolean {
        try {
            return !!localStorage.getItem(this.STORAGE_KEY);
        } catch {
            return false;
        }
    }

    getEffectiveUrl(): string {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || DEFAULT_GOOGLE_FINANCE_URL;
        } catch {
            return DEFAULT_GOOGLE_FINANCE_URL;
        }
    }

    setUrl(url: string) {
        const clean = (url || '').trim();
        try {
            if (clean && clean !== DEFAULT_GOOGLE_FINANCE_URL) {
                localStorage.setItem(this.STORAGE_KEY, clean);
                this.isCustom.set(true);
            } else {
                localStorage.removeItem(this.STORAGE_KEY);
                this.isCustom.set(false);
            }
        } catch {}
        this.apiUrl.set(clean || DEFAULT_GOOGLE_FINANCE_URL);
        this.isConfigured.set(true);
        this.cache.clear();
    }

    resetToDefault() {
        this.setUrl('');
    }

    /**
     * Test connection to the Google Apps Script endpoint with a benchmark stock.
     */
    async testConnection(testUrl?: string): Promise<{ success: boolean; message: string; quote?: GoogleFinanceQuote }> {
        const url = (testUrl || this.apiUrl()).trim();
        if (!url) {
            return { success: false, message: 'Google Apps Script Web App URL is required.' };
        }

        try {
            const endpoint = `${url}${url.includes('?') ? '&' : '?'}tickers=NSE:RELIANCE,NSE:TCS`;
            const res = await firstValueFrom(this.http.get<GoogleFinanceResponse>(endpoint));

            if (res && res.success && res.data) {
                const sample = res.data['NSE:RELIANCE'] || Object.values(res.data)[0];
                if (sample && sample.status === 'SUCCESS' && typeof sample.price === 'number') {
                    return {
                        success: true,
                        message: `Connected successfully! RELIANCE price: ₹${sample.price}`,
                        quote: sample
                    };
                }
            }

            return {
                success: false,
                message: res?.error || 'Endpoint responded, but returned no valid quote data.'
            };
        } catch (err: any) {
            return {
                success: false,
                message: `Failed to connect: ${err.message || 'Check URL permissions and ensure "Anyone" can access'}`
            };
        }
    }

    /**
     * Batch fetch quotes for multiple tickers.
     * Tickers can be plain e.g. "RELIANCE", or with exchange e.g. "NSE:RELIANCE", "NASDAQ:AAPL".
     */
    async fetchQuotes(tickers: string[]): Promise<Record<string, GoogleFinanceQuote>> {
        const endpoint = this.apiUrl();
        if (!endpoint || tickers.length === 0) return {};

        const results: Record<string, GoogleFinanceQuote> = {};
        const missing: string[] = [];
        const now = Date.now();

        for (const t of tickers) {
            const cached = this.cache.get(t);
            if (cached && (now - cached.time) < this.CACHE_TTL_MS) {
                results[t] = cached.quote;
            } else {
                missing.push(t);
            }
        }

        if (missing.length === 0) {
            return results;
        }

        try {
            // Batch up to 30 tickers per request to keep query string clean
            const chunkSize = 30;
            for (let i = 0; i < missing.length; i += chunkSize) {
                const chunk = missing.slice(i, i + chunkSize);
                const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}tickers=${encodeURIComponent(chunk.join(','))}`;
                const res = await firstValueFrom(this.http.get<GoogleFinanceResponse>(url));

                if (res && res.success && res.data) {
                    for (const [key, quote] of Object.entries(res.data)) {
                        results[key] = quote;
                        if (quote.status === 'SUCCESS') {
                            this.cache.set(key, { quote, time: now });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[GoogleFinanceService] Failed to fetch quotes:', err);
        }

        return results;
    }

    /**
     * Fetch a single stock quote.
     */
    async fetchQuote(ticker: string): Promise<GoogleFinanceQuote | null> {
        const quotes = await this.fetchQuotes([ticker]);
        return quotes[ticker] || Object.values(quotes)[0] || null;
    }
}
