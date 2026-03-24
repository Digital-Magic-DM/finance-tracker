import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Asset, AssetType } from '../models/finance.models';
import { AssetService } from './asset.service';
import { firstValueFrom } from 'rxjs';
import nseCompanies from '../features/assets/nse_companies.json';
import bseIsins from '../features/assets/bse_isin.json';

/**
 * Fetches live prices for stocks and mutual funds.
 * - Stocks / ETFs: Yahoo Finance via allorigins CORS proxy
 * - Mutual Funds: MFAPI (https://api.mfapi.in) — free Indian MF NAV API
 *   Yahoo Finance does NOT support Indian mutual fund ISIN codes.
 */
@Injectable({ providedIn: 'root' })
export class PriceService {
    private http = inject(HttpClient);
    private assetService = inject(AssetService);

    private PROXIES = [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?url=',
        'https://thingproxy.freeboard.io/fetch/'
    ];
    private MFAPI_BASE = 'https://api.mfapi.in/mf';

    // Cache ISIN → MFAPI scheme code mapping to avoid repeated lookups
    private schemeCodeCache = new Map<string, number | null>();

    // ISIN → Ticker mapping from local JSON
    private isinToTickerMap = new Map<string, string>();
    // Plain Symbol → Suffix Symbol (e.g., ITC -> ITC.NS)
    private symbolToTickerMap = new Map<string, string>();


    constructor() {
        // Initialize the maps from local JSON for O(1) lookups
        // We put bseIsins first so that nseCompanies (which come later) overwrite BSE entries for overlapping ISINs
        const allData = [...(bseIsins as any[]), ...(nseCompanies as any[])];
        
        for (const item of allData) {
            const isin = (item.ISIN_NUMBER || item.isin_number || '').toUpperCase();
            const symbol = (item.symbol || '').toUpperCase();
            
            if (isin) {
                this.isinToTickerMap.set(isin, symbol);
            }
            
            if (symbol) {
                const plainSymbol = symbol.split('.')[0];
                // Prefer NSE if both exist (most common)
                if (!this.symbolToTickerMap.has(plainSymbol) || symbol.endsWith('.NS')) {
                    this.symbolToTickerMap.set(plainSymbol, symbol);
                }
            }
        }
    }

    /**
     * Fetch & update the current price for a single asset.
     * Returns the updated price, or null if lookup failed.
     */
    async fetchPrice(asset: Asset): Promise<number | null> {
        try {
            if (asset.type === AssetType.MutualFund) {
                return await this.fetchMutualFundNAV(asset);
            }
            // Use per-asset fetcher with primary + fallback
            return await this.fetchSingleStockPrice(asset);
        } catch (err) {
            console.warn(`[PriceService] Failed to fetch price for ${asset.name}:`, err);
            return null;
        }
    }

    async refreshAllPrices(assets: Asset[]): Promise<{ updated: number; unchanged: number; failed: number }> {
        let updated = 0;
        let unchanged = 0;
        let failed = 0;

        // Separate MFs and Stocks
        const mfs = assets.filter(a => a.type === AssetType.MutualFund);
        const stocks = assets.filter(a => a.type !== AssetType.MutualFund);

        // 1. Process MFs individually (MFAPI doesn't have a clean bulk list endpoint)
        for (const asset of mfs) {
            const price = await this.fetchPrice(asset);
            if (price !== null && asset.id) {
                try {
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    await this.assetService.updateAsset(asset.id, { currentPrice: price, lastUpdated: now });
                    if (price !== asset.currentPrice) {
                        updated++;
                    } else {
                        unchanged++;
                    }
                } catch (err) {
                    console.error(`[PriceService] Failed to save MF price for ${asset.name}:`, err);
                    failed++;
                }
            } else if (price === null) {
                failed++;
            }
        }

        // 2. Process Stocks individually (one API call per stock, with fallback)
        if (stocks.length > 0) {
            const result = await this.fetchStockPricesIndividual(stocks);
            updated += result.updated;
            unchanged += result.unchanged;
            failed += result.failed;
        }

        console.log(`[PriceService] Refresh complete. Updated: ${updated}, Unchanged: ${unchanged}, Failed: ${failed}`);
        return { updated, unchanged, failed };
    }

    /**
     * Cache ISIN/Name → Yahoo Symbol mapping to avoid repeatedly searching Yahoo.
     */
    private yahooSymbolCache = new Map<string, string | null>();

    /**
     * Fetch stock prices one asset at a time.
     * Primary:  Yahoo Finance v8/chart endpoint  (via 3 CORS proxies)
     * Fallback: Yahoo Finance v7/quote endpoint  (via 3 CORS proxies)
     * Each asset is independent — one failure never blocks others.
     * Results are saved to Firestore immediately after each success.
     */
    private async fetchStockPricesIndividual(stocks: Asset[]): Promise<{ updated: number; unchanged: number; failed: number }> {
        let updated = 0;
        let unchanged = 0;
        let failed = 0;

        // Fire all API calls simultaneously
        const results = await Promise.all(
            stocks.map(async (asset) => {
                const price = await this.fetchSingleStockPrice(asset);
                return { asset, price };
            })
        );

        // Write results to Firestore (can still be parallel)
        await Promise.all(results.map(async ({ asset, price }) => {
            if (price !== null && asset.id) {
                try {
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    const updates: Partial<Asset> = { lastUpdated: now };
                    if (price !== asset.currentPrice) {
                        (updates as any).currentPrice = price;
                        updated++;
                    } else {
                        unchanged++;
                    }
                    await this.assetService.updateAsset(asset.id, updates);
                } catch (err) {
                    console.error(`[PriceService] Failed to save price for ${asset.name}:`, err);
                    failed++;
                }
            } else {
                failed++;
            }
        }));

        return { updated, unchanged, failed };
    }

    /**
     * Fetch price for a single stock asset.
     * Primary:  Yahoo v8/chart  — tries each proxy in order
     * Fallback: Yahoo v7/quote  — tries each proxy in order
     */
    private async fetchSingleStockPrice(asset: Asset): Promise<number | null> {
        // 1. Resolve the Yahoo ticker symbol
        let symbol: string | null = this.resolveYahooSymbol(asset);
        if (!symbol) {
            const cacheKey = asset.symbol || asset.name || '';
            if (this.yahooSymbolCache.has(cacheKey)) {
                symbol = this.yahooSymbolCache.get(cacheKey) || null;
            } else {
                symbol = await this.searchYahooSymbol(asset.name || '');
                this.yahooSymbolCache.set(cacheKey, symbol);
            }
        }

        if (!symbol) {
            console.warn(`[PriceService] Could not resolve symbol for: ${asset.name}`);
            return null;
        }

        // 2a. PRIMARY — Yahoo v8/chart
        const cb = Date.now();
        const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

        for (const host of yahooHosts) {
            const primaryUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&_cb=${cb}`;
            for (let pi = 0; pi < this.PROXIES.length; pi++) {
                try {
                    const data: any = await firstValueFrom(
                        this.http.get(`${this.PROXIES[pi]}${encodeURIComponent(primaryUrl)}`)
                    );
                    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
                    if (typeof price === 'number' && price > 0) {
                        console.log(`[PriceService] ✓ ${asset.name} → ₹${price} (v8/chart, ${host}, proxy ${pi})`);
                        return price;
                    }
                } catch (e: any) {
                    console.warn(`[PriceService] Primary v8/chart proxy ${pi} failed for ${symbol} on ${host}:`, e.message);
                }
            }
        }

        // 2b. FALLBACK — Yahoo v7/quote
        for (const host of yahooHosts) {
            const fallbackUrl = `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&_cb=${cb}`;
            for (let pi = 0; pi < this.PROXIES.length; pi++) {
                try {
                    const data: any = await firstValueFrom(
                        this.http.get(`${this.PROXIES[pi]}${encodeURIComponent(fallbackUrl)}`)
                    );
                    const price = data?.quoteResponse?.result?.[0]?.regularMarketPrice;
                    if (typeof price === 'number' && price > 0) {
                        console.log(`[PriceService] ✓ ${asset.name} → ₹${price} (v7/quote fallback, ${host}, proxy ${pi})`);
                        return price;
                    }
                } catch (e: any) {
                    console.warn(`[PriceService] Fallback v7/quote proxy ${pi} failed for ${symbol} on ${host}:`, e.message);
                }
            }
        }

        console.warn(`[PriceService] ✗ All attempts failed for ${asset.name} (${symbol})`);
        return null;
    }

    // ═══════════════════════════════════════════
    //  MUTUAL FUND NAV via MFAPI
    // ═══════════════════════════════════════════

    /**
     * Fetch latest NAV for an Indian mutual fund using MFAPI.
     * Supports lookup by AMFI scheme code or by searching the fund name.
     */
    private async fetchMutualFundNAV(asset: Asset): Promise<number | null> {
        const schemeCode = await this.resolveSchemeCode(asset);
        if (!schemeCode) {
            console.warn(`[PriceService] Could not resolve MFAPI scheme code for: ${asset.name}`);
            return null;
        }

        try {
            const data: any = await firstValueFrom(
                this.http.get(`${this.MFAPI_BASE}/${schemeCode}/latest`)
            );

            // MFAPI returns: { meta: {...}, data: [{ date, nav }] }
            const nav = parseFloat(data?.data?.[0]?.nav);
            if (!isNaN(nav) && nav > 0) {
                return nav;
            }
            return null;
        } catch (err) {
            console.warn(`[PriceService] MFAPI fetch failed for scheme ${schemeCode}:`, err);
            return null;
        }
    }

    /**
     * Resolve the MFAPI scheme code for a mutual fund.
     * Strategy:
     *  1. If asset.symbol is a pure numeric string → treat as scheme code directly
     *  2. If asset.symbol is an ISIN (starts with "INF", 12 chars) → search MFAPI by name
     *  3. Otherwise → search MFAPI by fund name
     */
    private async resolveSchemeCode(asset: Asset): Promise<number | null> {
        const symbol = (asset.symbol || '').trim();

        // 1. Already a numeric scheme code
        if (/^\d{4,6}$/.test(symbol)) {
            return parseInt(symbol, 10);
        }

        // Check cache (keyed by ISIN or name)
        const cacheKey = symbol || asset.name.toLowerCase();
        if (this.schemeCodeCache.has(cacheKey)) {
            return this.schemeCodeCache.get(cacheKey)!;
        }

        // 2 & 3. Search MFAPI by fund name
        const searchTerm = this.buildMFSearchTerm(asset);
        if (!searchTerm) {
            this.schemeCodeCache.set(cacheKey, null);
            return null;
        }

        try {
            const results: any[] = await firstValueFrom(
                this.http.get<any[]>(`${this.MFAPI_BASE}/search?q=${encodeURIComponent(searchTerm)}`)
            );

            if (results && results.length > 0) {
                // Try to find exact or best match
                const match = this.findBestSchemeMatch(results, asset.name);
                const code = match ? match.schemeCode : results[0].schemeCode;
                this.schemeCodeCache.set(cacheKey, code);
                return code;
            }

            console.warn(`[PriceService] No MFAPI results for search: "${searchTerm}"`);
            this.schemeCodeCache.set(cacheKey, null);
            return null;
        } catch (err) {
            console.warn(`[PriceService] MFAPI search failed for "${searchTerm}":`, err);
            this.schemeCodeCache.set(cacheKey, null);
            return null;
        }
    }

    /**
     * Build a search term for MFAPI from the fund name.
     * Strips common suffixes and keeps the core fund name.
     */
    private buildMFSearchTerm(asset: Asset): string {
        let name = asset.name.trim();
        // Remove common suffixes that may cause search mismatches
        name = name.replace(/\s*-\s*(Direct|Regular)\s*(Plan|Growth|IDCW|Dividend).*$/i, '');
        name = name.replace(/\s*(Direct|Regular)\s*(Plan|Growth|IDCW|Dividend).*$/i, '');
        // Keep first few meaningful words for search
        const words = name.split(/\s+/).slice(0, 5);
        return words.join(' ');
    }

    /**
     * Find the best matching scheme from MFAPI search results.
     * Prefers schemes whose name closely matches the asset name (case-insensitive).
     */
    private findBestSchemeMatch(results: any[], assetName: string): any {
        const lowerName = assetName.toLowerCase();

        // Exact match first
        const exact = results.find((r: any) =>
            r.schemeName?.toLowerCase() === lowerName
        );
        if (exact) return exact;

        // Partial match — best overlap
        let bestMatch: any = null;
        let bestScore = 0;

        for (const r of results) {
            const schemeName = (r.schemeName || '').toLowerCase();
            // Count how many words from the asset name appear in the scheme name
            const nameWords = lowerName.split(/\s+/);
            const score = nameWords.filter(w => w.length > 2 && schemeName.includes(w)).length;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = r;
            }
        }

        return bestMatch;
    }


    private async searchYahooSymbol(query: string): Promise<string | null> {
        if (!query) return null;
        
        // Clean up name (e.g. remove "Ltd", "Limited" for better search hits)
        const isISIN = this.isISIN(query);
        const cleanQuery = isISIN ? query : String(query).replace(/ltd\.?|limited/i, '').trim();
        const yahooSearchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=3`;

        let proxyIndex = 0;
        while (proxyIndex < this.PROXIES.length) {
            const url = `${this.PROXIES[proxyIndex]}${encodeURIComponent(yahooSearchUrl)}`;
            try {
                const data: any = await firstValueFrom(this.http.get(url));
                const quotes = data?.quotes || [];
                
                // Prefer NSE (.NS) then BSE (.BO)
                const nseMatch = quotes.find((q: any) => q.exchange === 'NSI' || q.symbol.endsWith('.NS'));
                if (nseMatch) return nseMatch.symbol;
                
                const bseMatch = quotes.find((q: any) => q.exchange === 'BSE' || q.symbol.endsWith('.BO'));
                if (bseMatch) return bseMatch.symbol;
                
                // Fallback to first quote if it looks like a stock
                if (quotes.length > 0 && quotes[0].quoteType === 'EQUITY') {
                     return quotes[0].symbol;
                }
                break; // Request succeeded but no symbols found
            } catch (e) {
                console.warn(`[PriceService] Yahoo search failed via ${this.PROXIES[proxyIndex]} for ${cleanQuery}`, e);
                proxyIndex++;
                if (proxyIndex < this.PROXIES.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        return null;
    }

    /**
     * Resolve a Yahoo Finance symbol from an asset (for non-MF types).
     * Skips ISIN codes since Yahoo doesn't support them.
     */
    private resolveYahooSymbol(asset: Asset): string | null {
        if (asset.symbol) {
            const sym = asset.symbol.trim().toUpperCase();

            // Already has a suffix like .NS or .BO
            if (sym.includes('.')) return sym;

            // Check ISIN map first
            if (this.isISIN(sym) && this.isinToTickerMap.has(sym)) {
                return this.isinToTickerMap.get(sym)!;
            }

            // Check local Symbol map (ITC -> ITC.NS)
            if (this.symbolToTickerMap.has(sym)) {
                return this.symbolToTickerMap.get(sym)!;
            }

            // Default to .NS for legacy or unknown plain tickers
            return `${sym}.NS`;
        }
        return null;
    }

    /**
     * Check if a string looks like an ISIN code.
     * Indian ISINs start with "IN" and are 12 characters long.
     */
    private isISIN(value: string): boolean {
        return /^IN[A-Z0-9]{10}$/.test(value);
    }
}
