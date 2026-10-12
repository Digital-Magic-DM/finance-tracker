import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TickerRegistryService {
    private isinToTickerMap = new Map<string, string>();
    private symbolToTickerMap = new Map<string, string>();
    private nseData: any[] | null = null;
    private bseData: any[] | null = null;
    private loadPromise: Promise<void> | null = null;

    /**
     * Lazily load BSE & NSE stock ticker and ISIN mappings once on-demand.
     */
    async ensureLoaded(): Promise<void> {
        if (this.isinToTickerMap.size > 0) return;
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = (async () => {
            try {
                const [nseMod, bseMod] = await Promise.all([
                    import('../features/assets/nse_companies.json'),
                    import('../features/assets/bse_isin.json')
                ]);

                this.nseData = nseMod.default || [];
                this.bseData = bseMod.default || [];

                const allData = [...this.bseData, ...this.nseData];
                for (const item of allData) {
                    const isin = (item.ISIN_NUMBER || item.isin_number || '').toUpperCase().trim();
                    const symbol = (item.symbol || '').toUpperCase().trim();

                    if (isin && symbol) {
                        if (!this.isinToTickerMap.has(isin) || symbol.endsWith('.NS')) {
                            this.isinToTickerMap.set(isin, symbol);
                        }
                    }

                    if (symbol) {
                        const plainSymbol = symbol.split('.')[0];
                        if (!this.symbolToTickerMap.has(plainSymbol) || symbol.endsWith('.NS')) {
                            this.symbolToTickerMap.set(plainSymbol, symbol);
                        }
                    }
                }
            } catch (err) {
                console.warn('[TickerRegistry] Failed to lazily load ticker mapping:', err);
            }
        })();

        return this.loadPromise;
    }

    lookupIsin(isin: string): string | undefined {
        const clean = (isin || '').toUpperCase().trim();
        return this.isinToTickerMap.get(clean);
    }

    lookupSymbol(plainSymbol: string): string | undefined {
        const clean = (plainSymbol || '').toUpperCase().trim();
        return this.symbolToTickerMap.get(clean);
    }

    async getNseData(): Promise<any[]> {
        await this.ensureLoaded();
        return this.nseData || [];
    }

    async getBseData(): Promise<any[]> {
        await this.ensureLoaded();
        return this.bseData || [];
    }
}
