import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Asset, AssetType } from '../models/finance.models';
import { AssetService } from './asset.service';
import { firstValueFrom } from 'rxjs';

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

    private PROXY = 'https://api.allorigins.win/raw?url=';
    private MFAPI_BASE = 'https://api.mfapi.in/mf';

    // Cache ISIN → MFAPI scheme code mapping to avoid repeated lookups
    private schemeCodeCache = new Map<string, number | null>();

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
            return await this.fetchYahooPrice(asset);
        } catch (err) {
            console.warn(`[PriceService] Failed to fetch price for ${asset.name}:`, err);
            return null;
        }
    }

    /**
     * Fetch live prices for all assets and update Firestore.
     * Returns the count of successfully updated assets.
     */
    async refreshAllPrices(assets: Asset[]): Promise<number> {
        let updated = 0;

        for (const asset of assets) {
            const price = await this.fetchPrice(asset);
            if (price !== null && price !== asset.currentPrice && asset.id) {
                try {
                    await this.assetService.updateAsset(asset.id, { currentPrice: price });
                    updated++;
                    console.log(`[PriceService] Updated ${asset.name}: ₹${price}`);
                } catch (err) {
                    console.error(`[PriceService] Failed to save price for ${asset.name}:`, err);
                }
            }
        }

        console.log(`[PriceService] Refresh complete. Updated: ${updated}/${assets.length}`);
        return updated;
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
                console.log(`[PriceService] MF NAV for ${asset.name}: ₹${nav} (scheme: ${schemeCode})`);
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
                console.log(`[PriceService] Resolved "${asset.name}" → scheme code ${code} (from ${results.length} results)`);
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

    /**
     * Fetch price from Yahoo Finance for stocks/ETFs.
     */
    private async fetchYahooPrice(asset: Asset): Promise<number | null> {
        const symbol = this.resolveYahooSymbol(asset);
        if (!symbol) return null;

        // Bust allorigins cache with a timestamp
        const cb = Date.now();
        const url = `${this.PROXY}${encodeURIComponent(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d&_cb=${cb}`
        )}`;

        const data: any = await firstValueFrom(this.http.get(url));
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

        if (price && typeof price === 'number' && price > 0) {
            return price;
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

            // Skip ISIN codes — Yahoo doesn't support them
            if (this.isISIN(sym)) {
                console.warn(`[PriceService] Skipping ISIN "${sym}" for Yahoo Finance (not supported). Use MFAPI for MF assets.`);
                return null;
            }

            // Regular NSE/BSE symbol
            return `${sym}.NS`;
        }

        // No symbol — try to derive from name for stocks
        if (asset.type === AssetType.Stock) {
            const firstWord = asset.name.split(/\s+/)[0].toUpperCase();
            if (firstWord.length >= 2 && firstWord.length <= 20) {
                return `${firstWord}.NS`;
            }
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
