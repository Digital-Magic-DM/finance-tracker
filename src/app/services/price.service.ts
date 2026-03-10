import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Asset, AssetType } from '../models/finance.models';
import { AssetService } from './asset.service';
import { firstValueFrom } from 'rxjs';

/**
 * Fetches live prices for stocks and mutual funds.
 * - Stocks: Yahoo Finance via allorigins CORS proxy
 * - Mutual Funds: Yahoo Finance (MF scheme names with .NS/.BO suffix)
 */
@Injectable({ providedIn: 'root' })
export class PriceService {
    private http = inject(HttpClient);
    private assetService = inject(AssetService);

    private PROXY = 'https://api.allorigins.win/raw?url=';

    /**
     * Fetch & update the current price for a single asset.
     * Returns the updated price, or null if lookup failed.
     */
    async fetchPrice(asset: Asset): Promise<number | null> {
        try {
            const symbol = this.resolveSymbol(asset);
            if (!symbol) return null;

            const url = `${this.PROXY}${encodeURIComponent(
                `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`
            )}`;

            const data: any = await firstValueFrom(this.http.get(url));
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

            if (price && typeof price === 'number' && price > 0) {
                return price;
            }
            return null;
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

    /**
     * Resolve a Yahoo Finance symbol from an asset.
     * Tries: symbol + .NS, ISIN, or name-based search.
     */
    private resolveSymbol(asset: Asset): string | null {
        // If we already have a symbol, append .NS for NSE
        if (asset.symbol) {
            const sym = asset.symbol.trim().toUpperCase();

            // Already has a suffix like .NS or .BO
            if (sym.includes('.')) return sym;

            // ISIN — try as-is (Yahoo sometimes supports ISIN.NS)
            if (sym.startsWith('IN') && sym.length === 12) {
                return `${sym}.NS`;
            }

            // Regular symbol
            return `${sym}.NS`;
        }

        // No symbol — try to derive from name
        // For stocks, try the first word as NSE symbol
        if (asset.type === AssetType.Stock) {
            const firstWord = asset.name.split(/\s+/)[0].toUpperCase();
            if (firstWord.length >= 2 && firstWord.length <= 20) {
                return `${firstWord}.NS`;
            }
        }

        return null;
    }
}
