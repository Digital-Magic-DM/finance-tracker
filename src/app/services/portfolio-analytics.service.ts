import { Injectable, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AssetService } from './asset.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { Asset } from '../models/finance.models';
import { environment } from '../../environments/environment';
import { map } from 'rxjs/operators';

export interface PortfolioSummary {
    totalValue: number;
    dailyChange: number;
    dailyChangePercent: number;
    topContributor: string;
}

@Injectable({ providedIn: 'root' })
export class PortfolioAnalyticsService {
    private assetService = inject(AssetService);

    // Get assets from the existing AssetService
    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });

    // Compute basic analytics locally from synced asset data
    summary = computed(() => {
        const assets = this.assets() as Asset[];
        if (!assets.length) return { totalValue: 0, dailyChange: 0, dailyChangePercent: 0, topContributor: 'N/A' };

        let total = 0;
        let topAsset = assets[0];
        let maxDailyGain = -Infinity;

        assets.forEach((asset: Asset) => {
            const currentVal = asset.quantity * (asset.currentPrice || 0);
            total += currentVal;
            
            const dailyGain = (asset.dailyChange || 0) * asset.quantity;
            if (dailyGain > maxDailyGain) {
                maxDailyGain = dailyGain;
                topAsset = asset;
            }
        });

        return {
            totalValue: total,
            dailyChange: assets.reduce((acc: number, a: Asset) => acc + (a.dailyChange || 0) * a.quantity, 0),
            dailyChangePercent: total > 0 ? ((assets.reduce((acc: number, a: Asset) => acc + (a.dailyChange || 0) * a.quantity, 0)) / (total - (assets.reduce((acc: number, a: Asset) => acc + (a.dailyChange || 0) * a.quantity, 0))) * 100) : 0,
            topContributor: topAsset.name
        };
    });
}
