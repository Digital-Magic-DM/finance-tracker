import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Asset, AssetType } from '../models/finance.models';
import { AssetService } from './asset.service';
import { GoogleFinanceService } from './google-finance.service';
import { TickerRegistryService } from './ticker-registry.service';
import { firstValueFrom } from 'rxjs';

export interface PriceQuoteResult {
    price: number;
    dailyChange?: number;
    navDate?: string;
}

/**
 * Fetches live prices for stocks, ETFs, and mutual funds.
 * - Stocks / ETFs: Google Finance (via Google Sheets Bridge) with Yahoo Finance CORS fallback
 * - US Stocks: Smart exchange resolution (NASDAQ, NYSE, NYSEARCA) on Google Finance
 * - Mutual Funds: MFAPI (https://api.mfapi.in) — smart search matching Direct/Regular and Growth/IDCW
 */
@Injectable({ providedIn: 'root' })
export class PriceService {
    private http = inject(HttpClient);
    private assetService = inject(AssetService);
    public googleFinance = inject(GoogleFinanceService);
    private tickerRegistry = inject(TickerRegistryService);

    // Working CORS proxies
    private PROXIES = [
        'https://api.allorigins.win/raw?url='
    ];
    private MFAPI_BASE = 'https://api.mfapi.in/mf';

    // Cache ISIN/symbol/name → MFAPI scheme code mapping to avoid repeated lookups
    private schemeCodeCache = new Map<string, number | null>();

    // Cache US symbol -> working exchange (e.g. AAPL -> NASDAQ, IBM -> NYSE, SPY -> NYSEARCA)
    private usExchangeCache = new Map<string, string>();

    private static KNOWN_ARCA_ETFS = new Set([
        'SPY', 'VOO', 'IVV', 'VTI', 'DIA', 'IWM', 'VT', 'VEA', 'VWO',
        'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'SCHD', 'SOXX', 'SMH', 'ARKK'
    ]);

    constructor() {}

    public static readonly POPULAR_US_SYMBOLS = new Set([
        'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BLK', 'IBM',
        'BRK.A', 'BRK.B', 'BRK_A', 'BRK_B', 'JNJ', 'V', 'MA', 'PG', 'JPM', 'UNH', 'HD',
        'CVX', 'XOM', 'ABBV', 'LLY', 'KO', 'PEP', 'COST', 'AVGO', 'WMT', 'MCD', 'CSCO',
        'TMO', 'ABT', 'DIS', 'NFLX', 'AMD', 'INTC', 'QCOM', 'TXN', 'CRM', 'ORCL', 'ADBE',
        'PYPL', 'COIN', 'UBER', 'ABNB', 'PLTR', 'SNOW', 'SQ', 'SHOP', 'BABA', 'NKE', 'SBUX',
        'BA', 'GE', 'CAT', 'GS', 'MS', 'BAC', 'C', 'WFC',
        'SPY', 'VOO', 'IVV', 'QQQ', 'VTI', 'DIA', 'IWM', 'VT', 'VEA', 'VWO',
        'XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLP', 'XLY', 'SCHD', 'JEPI', 'ARKK', 'SOXX', 'SMH'
    ]);

    /**
     * Check if an asset is a US holding.
     */
    public isUSAsset(asset: Asset): boolean {
        if (!asset) return false;
        if (asset.type === AssetType.USStock) return true;
        if (asset.currency === 'USD') return true;
        if (asset.notes && /us stock|alpaca|nasdaq|nyse|vested|indmoney \(us/i.test(asset.notes)) return true;
        if (asset.appSource && /alpaca|vested|drivewealth/i.test(asset.appSource)) return true;
        const sym = (asset.symbol || '').toUpperCase().trim();
        if (sym.startsWith('NASDAQ:') || sym.startsWith('NYSE:') || sym.startsWith('NYSEARCA:') || sym.endsWith('.US')) return true;
        const cleanSym = sym.replace(/^(NASDAQ:|NYSE:|NYSEARCA:)/, '').replace(/\.(US|O|N)$/, '');
        if (cleanSym && PriceService.POPULAR_US_SYMBOLS.has(cleanSym)) return true;
        return false;
    }

    /**
     * Resolve Google Finance candidate tickers for an asset.
     * US stocks generate [NASDAQ:..., NYSE:..., NYSEARCA:...] candidates so Google Finance always finds them.
     */
    public getGoogleFinanceTickerCandidates(asset: Asset): string[] {
        let sym = (asset.symbol || '').trim().toUpperCase();

        // 1. If sym is an ISIN, look up in ticker registry
        if (this.isISIN(sym)) {
            sym = (this.tickerRegistry.lookupIsin(sym) || '').toUpperCase();
        }

        // 2. If sym is empty, check if asset.name matches any ticker
        if (!sym && asset.name) {
            const clean = asset.name.toUpperCase().trim();
            const mapped = this.tickerRegistry.lookupSymbol(clean);
            if (mapped) {
                sym = mapped;
            }
        }

        if (!sym) {
            const cleanName = (asset.name || '').trim().toUpperCase();
            if (!cleanName.includes(' ')) {
                sym = cleanName;
            }
        }

        if (!sym) return [];

        // 3. If ticker already has explicit exchange prefix e.g. "NASDAQ:AAPL" or "NSE:RELIANCE"
        if (sym.includes(':')) {
            return [sym];
        }

        // 4. US stocks / ETFs
        if (this.isUSAsset(asset)) {
            const cleanSym = sym.replace(/\.(US|O|N)$/, '');

            if (this.usExchangeCache.has(cleanSym)) {
                return [`${this.usExchangeCache.get(cleanSym)}:${cleanSym}`];
            }

            if (PriceService.KNOWN_ARCA_ETFS.has(cleanSym)) {
                return [
                    `NYSEARCA:${cleanSym}`,
                    `NASDAQ:${cleanSym}`,
                    `NYSE:${cleanSym}`
                ];
            }

            return [
                `NASDAQ:${cleanSym}`,
                `NYSE:${cleanSym}`,
                `NYSEARCA:${cleanSym}`
            ];
        }

        // 5. Indian NSE / BSE
        if (sym.endsWith('.NS')) {
            return [`NSE:${sym.replace('.NS', '')}`];
        }
        if (sym.endsWith('.BO')) {
            return [`BOM:${sym.replace('.BO', '')}`];
        }

        const mapped = this.tickerRegistry.lookupSymbol(sym);
        if (mapped) {
            if (mapped.endsWith('.BO')) {
                return [`BOM:${mapped.replace('.BO', '')}`];
            }
            return [`NSE:${mapped.replace('.NS', '')}`];
        }

        return [`NSE:${sym}`];
    }

    /**
     * Legacy single ticker resolution for backward compatibility.
     */
    public getGoogleFinanceTicker(asset: Asset): string | null {
        const cands = this.getGoogleFinanceTickerCandidates(asset);
        return cands.length > 0 ? cands[0] : null;
    }

    /**
     * Fetch & update the current price for a single asset.
     */
    async fetchPrice(asset: Asset): Promise<number | null> {
        const res = await this.fetchPriceDetails(asset);
        return res ? res.price : null;
    }

    /**
     * Fetch current price along with daily change percentage for a single asset.
     */
    async fetchPriceDetails(asset: Asset): Promise<PriceQuoteResult | null> {
        try {
            await this.tickerRegistry.ensureLoaded();
            if (asset.type === AssetType.MutualFund) {
                return await this.fetchMutualFundNAV(asset);
            }
            return await this.fetchSingleStockPrice(asset);
        } catch (err) {
            console.warn(`[PriceService] Failed to fetch price for ${asset.name}:`, err);
            return null;
        }
    }

    /**
     * Format today's date as YYYY-MM-DD for date-level comparison.
     */
    public getTodayDateString(): string {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Check if a mutual fund's NAV has already been updated today.
     */
    public isMFUpdatedToday(asset: Asset): boolean {
        return asset.type === AssetType.MutualFund && asset.lastUpdatedDate === this.getTodayDateString();
    }

    async refreshAllPrices(assets: Asset[], forceMF = false): Promise<{ 
        updated: number; 
        unchanged: number; 
        failed: number; 
        mfSkipped: number; 
        mfUpdated: number 
    }> {
        await this.tickerRegistry.ensureLoaded();
        let updated = 0;
        let unchanged = 0;
        let failed = 0;
        let mfSkipped = 0;
        let mfUpdated = 0;

        const todayStr = this.getTodayDateString();

        // Separate MFs and Stocks
        const allMfs = assets.filter(a => a.type === AssetType.MutualFund);
        const stocks = assets.filter(a => a.type !== AssetType.MutualFund);

        // 1. Process Mutual Funds (Only update once per day unless forceMF is true)
        let mfsToUpdate: Asset[];
        if (forceMF) {
            mfsToUpdate = allMfs;
        } else {
            mfsToUpdate = allMfs.filter(a => a.lastUpdatedDate !== todayStr);
            mfSkipped = allMfs.length - mfsToUpdate.length;
        }

        for (const asset of mfsToUpdate) {
            const res = await this.fetchPriceDetails(asset);
            if (res !== null && asset.id) {
                try {
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    const updates: Partial<Asset> = { 
                        currentPrice: res.price, 
                        lastUpdated: now,
                        lastUpdatedDate: todayStr
                    };
                    if (res.dailyChange !== undefined) {
                        updates.dailyChange = res.dailyChange;
                    }
                    if (res.navDate) {
                        updates.navDate = res.navDate;
                    }
                    await this.assetService.updateAsset(asset.id, updates);
                    if (res.price !== asset.currentPrice) {
                        updated++;
                    } else {
                        unchanged++;
                    }
                    mfUpdated++;
                } catch (err) {
                    console.error(`[PriceService] Failed to save MF price for ${asset.name}:`, err);
                    failed++;
                }
            } else if (res === null) {
                failed++;
            }
        }

        // 2. Process Stocks & ETFs (Indian and US - always refreshed)
        if (stocks.length > 0) {
            const result = await this.fetchStockPricesIndividual(stocks);
            updated += result.updated;
            unchanged += result.unchanged;
            failed += result.failed;
        }

        console.log(`[PriceService] Refresh complete. Updated: ${updated}, Unchanged: ${unchanged}, Failed: ${failed}, MFSkipped: ${mfSkipped}`);
        return { updated, unchanged, failed, mfSkipped, mfUpdated };
    }

    private yahooSymbolCache = new Map<string, string | null>();

    /**
     * Fetch stock prices.
     * Primary:  Google Finance batch lookup (supports NSE, BSE, NASDAQ, NYSE, NYSEARCA)
     * Fallback: Yahoo Finance v8/chart endpoint via CORS proxy
     */
    private async fetchStockPricesIndividual(stocks: Asset[]): Promise<{ updated: number; unchanged: number; failed: number }> {
        let updated = 0;
        let unchanged = 0;
        let failed = 0;

        let remainingStocks = [...stocks];
        if (this.googleFinance.isConfigured() && stocks.length > 0) {
            try {
                const candidateMap = new Map<string, Asset[]>();
                const allTickersToFetch = new Set<string>();

                for (const asset of stocks) {
                    const candidates = this.getGoogleFinanceTickerCandidates(asset);
                    for (const cand of candidates) {
                        if (!candidateMap.has(cand)) {
                            candidateMap.set(cand, []);
                        }
                        candidateMap.get(cand)!.push(asset);
                        allTickersToFetch.add(cand);
                    }
                }

                if (allTickersToFetch.size > 0) {
                    const quotes = await this.googleFinance.fetchQuotes(Array.from(allTickersToFetch));
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    const handledIds = new Set<string>();

                    for (const [ticker, quote] of Object.entries(quotes)) {
                        if (quote.status === 'SUCCESS' && typeof quote.price === 'number' && quote.price > 0) {
                            if (ticker.includes(':')) {
                                const [exch, sym] = ticker.split(':');
                                if (exch === 'NASDAQ' || exch === 'NYSE' || exch === 'NYSEARCA') {
                                    this.usExchangeCache.set(sym, exch);
                                }
                            }

                            const assetsToUpdate = candidateMap.get(ticker) || [];
                            for (const asset of assetsToUpdate) {
                                if (asset.id && !handledIds.has(asset.id)) {
                                    handledIds.add(asset.id);
                                    const updates: Partial<Asset> = {
                                        currentPrice: quote.price,
                                        lastUpdated: now,
                                        lastUpdatedDate: this.getTodayDateString(),
                                        dailyChange: quote.changePercent
                                    };
                                    // Ensure US assets are explicitly stored with currency 'USD'
                                    if (this.isUSAsset(asset) && asset.currency !== 'USD') {
                                        updates.currency = 'USD';
                                    }

                                    await this.assetService.updateAsset(asset.id, updates);
                                    if (quote.price !== asset.currentPrice) {
                                        updated++;
                                    } else {
                                        unchanged++;
                                    }
                                }
                            }
                        }
                    }

                    remainingStocks = stocks.filter(a => !handledIds.has(a.id!));
                    if (remainingStocks.length === 0) {
                        return { updated, unchanged, failed };
                    }
                }
            } catch (err) {
                console.warn('[PriceService] Google Finance batch failed, continuing to individual lookup:', err);
            }
        }

        // 2. Individual fallback for any remaining stocks
        const results = await Promise.all(
            remainingStocks.map(async (asset) => {
                const details = await this.fetchSingleStockPrice(asset);
                return { asset, details };
            })
        );

        // Write results to Firestore
        await Promise.all(results.map(async ({ asset, details }) => {
            if (details !== null && asset.id) {
                try {
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    const updates: Partial<Asset> = { 
                        lastUpdated: now,
                        lastUpdatedDate: this.getTodayDateString()
                    };
                    if (details.price !== asset.currentPrice) {
                        updates.currentPrice = details.price;
                        updated++;
                    } else {
                        unchanged++;
                    }
                    if (details.dailyChange !== undefined) {
                        updates.dailyChange = details.dailyChange;
                    }
                    if (this.isUSAsset(asset) && asset.currency !== 'USD') {
                        updates.currency = 'USD';
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
     * Fetch price & change for a single stock asset.
     */
    private async fetchSingleStockPrice(asset: Asset): Promise<PriceQuoteResult | null> {
        // 1. Google Finance
        if (this.googleFinance.isConfigured()) {
            const candidates = this.getGoogleFinanceTickerCandidates(asset);
            if (candidates.length > 0) {
                const quotes = await this.googleFinance.fetchQuotes(candidates);
                for (const [cand, quote] of Object.entries(quotes)) {
                    if (quote && quote.status === 'SUCCESS' && typeof quote.price === 'number' && quote.price > 0) {
                        if (cand.includes(':')) {
                            const [exch, sym] = cand.split(':');
                            if (exch === 'NASDAQ' || exch === 'NYSE' || exch === 'NYSEARCA') {
                                this.usExchangeCache.set(sym, exch);
                            }
                        }
                        return { price: quote.price, dailyChange: quote.changePercent };
                    }
                }
            }
        }

        // 2. Resolve Yahoo symbol
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

        // 3. Fallback: Yahoo v8/chart via proxy
        const cb = Date.now();
        const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

        for (const host of yahooHosts) {
            const primaryUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&_cb=${cb}`;
            for (let pi = 0; pi < this.PROXIES.length; pi++) {
                try {
                    const data: any = await firstValueFrom(
                        this.http.get(`${this.PROXIES[pi]}${encodeURIComponent(primaryUrl)}`)
                    );
                    const meta = data?.chart?.result?.[0]?.meta;
                    const price = meta?.regularMarketPrice;
                    if (typeof price === 'number' && price > 0) {
                        let dailyChange: number | undefined = undefined;
                        const prevClose = meta?.chartPreviousClose || meta?.previousClose;
                        if (typeof prevClose === 'number' && prevClose > 0) {
                            dailyChange = Math.round(((price - prevClose) / prevClose) * 10000) / 100;
                        }
                        return { price, dailyChange };
                    }
                } catch (e: any) {
                    console.warn(`[PriceService] Proxy ${pi} failed for ${symbol} on ${host}:`, e.message);
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
     * Fetch latest NAV & daily change for an Indian mutual fund using MFAPI.
     */
    private async fetchMutualFundNAV(asset: Asset): Promise<PriceQuoteResult | null> {
        const schemeCode = await this.resolveSchemeCode(asset);
        if (!schemeCode) {
            console.warn(`[PriceService] Could not resolve MFAPI scheme code for: ${asset.name}`);
            return null;
        }

        try {
            const data: any = await firstValueFrom(
                this.http.get(`${this.MFAPI_BASE}/${schemeCode}`)
            );

            // MFAPI returns: { meta: {...}, data: [{ date, nav }, { date, nav }, ...] }
            const nav = parseFloat(data?.data?.[0]?.nav);
            const navDate = data?.data?.[0]?.date;
            if (!isNaN(nav) && nav > 0) {
                let dailyChange: number | undefined = undefined;
                const prevNav = parseFloat(data?.data?.[1]?.nav);
                if (!isNaN(prevNav) && prevNav > 0) {
                    dailyChange = Math.round(((nav - prevNav) / prevNav) * 10000) / 100;
                }
                return { price: nav, dailyChange, navDate };
            }
            return null;
        } catch (err) {
            console.warn(`[PriceService] MFAPI fetch failed for scheme ${schemeCode}:`, err);
            return null;
        }
    }

    /**
     * Resolve the MFAPI scheme code for a mutual fund with plan-awareness (Direct vs Regular, Growth vs IDCW).
     */
    private async resolveSchemeCode(asset: Asset): Promise<number | null> {
        const symbol = (asset.symbol || '').trim();

        // 1. Already a numeric scheme code
        if (/^\d{4,6}$/.test(symbol)) {
            return parseInt(symbol, 10);
        }

        // Check cache (keyed by symbol or name)
        const cacheKey = (symbol || asset.name).toLowerCase().trim();
        if (this.schemeCodeCache.has(cacheKey)) {
            return this.schemeCodeCache.get(cacheKey)!;
        }

        const isRegular = /regular/i.test(asset.name);
        const isDirect = /direct/i.test(asset.name) || (!isRegular && (asset.appSource === 'Groww' || asset.appSource === 'Zerodha' || asset.appSource === 'INDmoney' || asset.appSource === 'Kuvera'));
        const isDividend = /idcw|dividend|payout|reinvest/i.test(asset.name);
        const isGrowth = !isDividend;

        // Clean fund name to key words
        const cleanName = asset.name
            .replace(/\s*-\s*/g, ' ')
            .replace(/\b(Direct|Regular|Plan|Growth|IDCW|Dividend|Option|Mutual Fund|Fund)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const coreWords = cleanName.split(' ').filter(w => w.length > 1).slice(0, 4);

        // Targeted search (e.g. "Parag Parikh Flexi Cap Direct Growth")
        const targetedQuery = [
            ...coreWords,
            isDirect ? 'Direct' : (isRegular ? 'Regular' : ''),
            isGrowth ? 'Growth' : 'IDCW'
        ].filter(Boolean).join(' ');

        let results: any[] = [];
        try {
            results = await firstValueFrom(
                this.http.get<any[]>(`${this.MFAPI_BASE}/search?q=${encodeURIComponent(targetedQuery)}`)
            );
        } catch {}

        // Fallback to broader search if targeted search had no results
        if (!results || results.length === 0) {
            const broadQuery = coreWords.slice(0, 3).join(' ');
            if (broadQuery) {
                try {
                    results = await firstValueFrom(
                        this.http.get<any[]>(`${this.MFAPI_BASE}/search?q=${encodeURIComponent(broadQuery)}`)
                    );
                } catch {}
            }
        }

        if (results && results.length > 0) {
            const match = this.findBestSchemeMatch(results, asset.name, isDirect, isRegular, isGrowth, isDividend);
            const code = match ? match.schemeCode : results[0].schemeCode;
            this.schemeCodeCache.set(cacheKey, code);
            return code;
        }

        console.warn(`[PriceService] No MFAPI results for search: "${asset.name}"`);
        this.schemeCodeCache.set(cacheKey, null);
        return null;
    }

    private findBestSchemeMatch(
        results: any[],
        assetName: string,
        isDirect: boolean,
        isRegular: boolean,
        isGrowth: boolean,
        isDividend: boolean
    ): any {
        const lowerName = assetName.toLowerCase();
        let bestMatch: any = null;
        let bestScore = -999;

        for (const r of results) {
            const schemeName = (r.schemeName || '').toLowerCase();
            let score = 0;

            const schemeIsDirect = schemeName.includes('direct');
            const schemeIsRegular = schemeName.includes('regular');

            if (isDirect) {
                if (schemeIsDirect) score += 50;
                if (schemeIsRegular) score -= 100;
            } else if (isRegular) {
                if (schemeIsRegular) score += 50;
                if (schemeIsDirect) score -= 100;
            }

            const schemeIsDividend = schemeName.includes('idcw') || schemeName.includes('dividend');
            const schemeIsGrowth = schemeName.includes('growth');

            if (isGrowth) {
                if (schemeIsGrowth) score += 40;
                if (schemeIsDividend) score -= 80;
            } else if (isDividend) {
                if (schemeIsDividend) score += 40;
                if (schemeIsGrowth) score -= 80;
            }

            const nameWords = lowerName.split(/\s+/).filter(w => w.length > 2);
            for (const word of nameWords) {
                if (schemeName.includes(word)) {
                    score += 10;
                }
            }

            if (schemeName.includes('bonus') && !lowerName.includes('bonus')) {
                score -= 50;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = r;
            }
        }

        return bestMatch;
    }

    private async searchYahooSymbol(query: string): Promise<string | null> {
        if (!query) return null;
        
        const isISIN = this.isISIN(query);
        const cleanQuery = isISIN ? query : String(query).replace(/ltd\.?|limited/i, '').trim();
        const yahooSearchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=3`;

        for (const proxy of this.PROXIES) {
            const url = `${proxy}${encodeURIComponent(yahooSearchUrl)}`;
            try {
                const data: any = await firstValueFrom(this.http.get(url));
                const quotes = data?.quotes || [];
                
                const nseMatch = quotes.find((q: any) => q.exchange === 'NSI' || q.symbol.endsWith('.NS'));
                if (nseMatch) return nseMatch.symbol;
                
                const bseMatch = quotes.find((q: any) => q.exchange === 'BSE' || q.symbol.endsWith('.BO'));
                if (bseMatch) return bseMatch.symbol;
                
                if (quotes.length > 0 && quotes[0].quoteType === 'EQUITY') {
                     return quotes[0].symbol;
                }
                break;
            } catch (e) {
                console.warn(`[PriceService] Yahoo search failed for ${cleanQuery}`, e);
            }
        }

        return null;
    }

    private resolveYahooSymbol(asset: Asset): string | null {
        if (asset.symbol) {
            const sym = asset.symbol.trim().toUpperCase();

            // US assets should be stripped of exchange prefixes/suffixes and NOT mapped to Indian tickers
            if (this.isUSAsset(asset)) {
                return sym.replace(/^(NASDAQ:|NYSE:|NYSEARCA:)/, '').replace(/\.(US|O|N)$/, '');
            }

            if (sym.includes('.')) return sym;

            if (this.isISIN(sym)) {
                const mapped = this.tickerRegistry.lookupIsin(sym);
                if (mapped) return mapped;
            }

            const mapped = this.tickerRegistry.lookupSymbol(sym);
            if (mapped) {
                return mapped;
            }

            return `${sym}.NS`;
        }
        return null;
    }

    private isISIN(value: string): boolean {
        return /^IN[A-Z0-9]{10}$/.test(value);
    }
}
