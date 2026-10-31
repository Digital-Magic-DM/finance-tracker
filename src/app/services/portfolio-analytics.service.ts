import { Injectable, inject, computed } from '@angular/core';
import { AssetService } from './asset.service';
import { PriceService } from './price.service';
import { GoogleFinanceService } from './google-finance.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { Asset, AssetType } from '../models/finance.models';

export interface PortfolioSummary {
    totalValue: number;
    dailyChange: number;
    dailyChangePercent: number;
    topContributor: string;
}

@Injectable({ providedIn: 'root' })
export class PortfolioAnalyticsService {
    private assetService = inject(AssetService);
    private priceService = inject(PriceService);
    private googleFinance = inject(GoogleFinanceService);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });

    summary = computed(() => {
        const assets = this.assets() as Asset[];
        if (!assets.length) return { totalValue: 0, dailyChange: 0, dailyChangePercent: 0, topContributor: 'N/A' };

        let total = 0;
        let totalDaily = 0;
        let topAsset = assets[0];
        let maxDailyGain = -Infinity;

        assets.forEach((asset: Asset) => {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (asset.type === AssetType.Cash || asset.type === AssetType.SavingsAccount || asset.type === AssetType.RealEstate || asset.type === AssetType.Bond || asset.type === AssetType.FixedDeposit ? asset.buyPrice : 0);
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            const currentVal = asset.quantity * cp * fx;
            total += currentVal;
            
            const pct = (asset.dailyChange || 0) / 100;
            const dailyGain = cp * pct * asset.quantity * fx;
            totalDaily += dailyGain;

            if (dailyGain > maxDailyGain) {
                maxDailyGain = dailyGain;
                topAsset = asset;
            }
        });

        return {
            totalValue: total,
            dailyChange: totalDaily,
            dailyChangePercent: total > 0 ? (totalDaily / total) * 100 : 0,
            topContributor: topAsset?.name || 'N/A'
        };
    });
}
