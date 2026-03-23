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
        const allData = [...(nseCompanies as any[]), ...(bseIsins as any[])];
        
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
            // Use MFAPI for mutual funds
            if (asset.type === AssetType.MutualFund) {
                return await this.fetchMutualFundNAV(asset);
            }

            // Use Yahoo Finance for stocks, ETFs, etc.
            return await this.fetchStockPrice(asset);
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

        // 2. Process Stocks in Bulk
        if (stocks.length > 0) {
             const result = await this.fetchStockPricesBulk(stocks);
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
     * Fetch all stock prices in a single batched request.
     */
    private async fetchStockPricesBulk(stocks: Asset[]): Promise<{ updated: number; unchanged: number; failed: number }> {
        let updated = 0;
        let unchanged = 0;
        let failed = 0;

        const symbolMap = new Map<string, Asset[]>();
        const symbolsToFetch: string[] = [];

        for (const asset of stocks) {
            let symbol = this.resolveYahooSymbol(asset);

            if (!symbol) {
                const cacheKey = asset.symbol || asset.name || '';
                if (this.yahooSymbolCache.has(cacheKey)) {
                    symbol = this.yahooSymbolCache.get(cacheKey) || null;
                } else {
                    symbol = await this.searchYahooSymbol(asset.name || '');
                    this.yahooSymbolCache.set(cacheKey, symbol);
                }
            }

            if (symbol) {
                symbolsToFetch.push(symbol);
                if (!symbolMap.has(symbol)) symbolMap.set(symbol, []);
                symbolMap.get(symbol)!.push(asset);
            } else {
                failed++;
            }
        }

        if (symbolsToFetch.length === 0) return { updated, unchanged, failed };

        // Process in chunks of 50 to avoid URL length issues
        const chunkSize = 50;
        for (let i = 0; i < symbolsToFetch.length; i += chunkSize) {
            const chunk = symbolsToFetch.slice(i, i + chunkSize);
            const commaSeparatedSymbols = chunk.join(',');
            const cb = Date.now();
            const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${commaSeparatedSymbols}&_cb=${cb}`;
            
            let searchSuccess = false;
            let proxyIndex = 0;

            while (!searchSuccess && proxyIndex < this.PROXIES.length) {
                const proxyUrl = `${this.PROXIES[proxyIndex]}${encodeURIComponent(yahooUrl)}`;
                try {
                    const data: any = await firstValueFrom(this.http.get(proxyUrl));
                    const results = data?.quoteResponse?.result || [];

                    for (const quote of results) {
                        const symbol = quote.symbol;
                        const price = quote.regularMarketPrice;
                        const changePct = quote.regularMarketChangePercent;
                        const assets = symbolMap.get(symbol) || [];

                        for (const asset of assets) {
                            if (asset.id && price && typeof price === 'number' && price > 0) {
                                const updates: any = {};
                                const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                                if (price !== asset.currentPrice) updates.currentPrice = price;
                                if (changePct !== undefined) updates.dailyChange = changePct;
                                updates.lastUpdated = now;

                                if (Object.keys(updates).length > 0) {
                                    await this.assetService.updateAsset(asset.id, updates);
                                    updated++;
                                } else {
                                    unchanged++;
                                }
                            }
                        }
                        symbolMap.delete(symbol);
                    }
                    searchSuccess = true;
                } catch (err: any) {
                    console.warn(`[PriceService] Chunk failed via proxy ${proxyIndex}:`, err.message);
                    proxyIndex++;
                }
            }
        }

        failed += symbolMap.size;
        return { updated, unchanged, failed };
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

    // ═══════════════════════════════════════════
    //  YAHOO FINANCE (Stocks, ETFs, etc.)
    // ═══════════════════════════════════════════

    private async fetchStockPrice(asset: Asset): Promise<number | null> {
        let symbol: string | null = this.resolveYahooSymbol(asset);
        
        // 1. Resolve Yahoo Symbol if missing or ISIN
        if (!symbol || this.isISIN(asset?.symbol || '')) {
             const isin = this.isISIN(asset?.symbol || '') ? asset.symbol! : '';
             const cacheKey = asset.symbol || asset.name || '';

             if (isin && this.isinToTickerMap.has(isin)) {
                 symbol = this.isinToTickerMap.get(isin)!;
             } else if (this.yahooSymbolCache.has(cacheKey)) {
                 symbol = this.yahooSymbolCache.get(cacheKey) || null;
             } else {
                 const searchQuery = isin || asset.name || '';
                 symbol = await this.searchYahooSymbol(searchQuery);
                 this.yahooSymbolCache.set(cacheKey, symbol);
             }
        }

        if (!symbol) {
             console.warn(`[PriceService] Could not resolve Yahoo symbol for ${asset.name}`);
             return null;
        }

        // 2. Fetch from Yahoo Finance (via proxies)
        const cb = Date.now();
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d&_cb=${cb}`;
        
        let proxyIndex = 0;
        while (proxyIndex < this.PROXIES.length) {
            const url = `${this.PROXIES[proxyIndex]}${encodeURIComponent(yahooUrl)}`;
            try {
                const data: any = await firstValueFrom(this.http.get(url));
                const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

                if (price && typeof price === 'number' && price > 0) {
                    return price;
                }
                break; // Succeeded but no price? Break out.
            } catch (e: any) {
                 console.warn(`[PriceService] Yahoo fetch failed via proxy ${this.PROXIES[proxyIndex]} for ${symbol} (${asset.name}):`, e.message);
                 proxyIndex++;
                 if (proxyIndex < this.PROXIES.length) {
                     await new Promise(resolve => setTimeout(resolve, 500));
                 }
            }
        }
        
        return null;
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
