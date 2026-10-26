import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
    Firestore,
    collectionData,
    query,
    orderBy,
} from '@angular/fire/firestore';
import { doc, setDoc, collection } from 'firebase/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { PortfolioSnapshot, Asset, AssetType, NetWorthPoint } from '../models/finance.models';
import { PriceService } from './price.service';
import { GoogleFinanceService } from './google-finance.service';
import { EmiService } from './emi.service';

@Injectable({ providedIn: 'root' })
export class SnapshotService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private injector = inject(Injector);
    private priceService = inject(PriceService);
    private googleFinance = inject(GoogleFinanceService);
    private emiService = inject(EmiService);

    async saveSnapshot(assets: Asset[]): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid || assets.length === 0) return;

        const today = new Date().toISOString().split('T')[0];
        const breakdown: any = {};
        let totalAssets = 0;
        let totalInvested = 0;

        for (const asset of assets) {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (asset.type === AssetType.Cash || asset.type === AssetType.RealEstate || asset.type === AssetType.Bond || asset.type === AssetType.FixedDeposit ? asset.buyPrice : 0);
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            const value = asset.quantity * cp * fx;
            const cost = asset.quantity * asset.buyPrice * fx;
            breakdown[asset.type] = (breakdown[asset.type] || 0) + value;
            totalAssets += value;
            totalInvested += cost;
        }

        const totalLiabilities = this.emiService.summaryMetrics().totalOutstandingBalance || 0;
        const snapshot: PortfolioSnapshot = {
            date: today,
            netWorth: Math.max(0, totalAssets - totalLiabilities),
            totalAssets,
            totalLiabilities,
            totalInvested,
            totalProfit: totalAssets - totalInvested,
            breakdown,
        };

        const ref = doc(this.firestore, `users/${uid}/snapshots/${today}`);
        await setDoc(ref, snapshot, { merge: true });
    }

    getSnapshots(): Observable<PortfolioSnapshot[]> {
        return new Observable<PortfolioSnapshot[]>(subscriber => {
            runInInjectionContext(this.injector, () => {
                const uid = this.auth.currentUser?.uid;
                if (!uid) { subscriber.next([]); subscriber.complete(); return; }
                const col = collection(this.firestore, `users/${uid}/snapshots`);
                const q = query(col, orderBy('date', 'asc'));
                const sub = (collectionData(q, { idField: 'id' }) as Observable<PortfolioSnapshot[]>)
                    .subscribe(subscriber);
                return () => sub.unsubscribe();
            });
        });
    }

    buildNetWorthPoints(snapshots: PortfolioSnapshot[], assets: Asset[] = []): NetWorthPoint[] {
        let currentCost = 0;
        let currentNetWorth = 0;
        for (const a of assets) {
            const cp = a.currentPrice > 0 ? a.currentPrice : (a.type === AssetType.Cash || a.type === AssetType.RealEstate || a.type === AssetType.Bond || a.type === AssetType.FixedDeposit ? a.buyPrice : 0);
            const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
            currentNetWorth += a.quantity * cp * fx;
            currentCost += a.quantity * a.buyPrice * fx;
        }

        const pointsMap = new Map<string, NetWorthPoint>();

        // 1. Process all snapshots
        for (const s of snapshots) {
            if (!s.date || isNaN(s.netWorth)) continue;

            let invested = s.totalInvested;
            let profit = s.totalProfit;

            if (invested === undefined || invested === null) {
                if (currentNetWorth > 0 && currentCost > 0) {
                    const ratio = Math.min(1.5, Math.max(0.1, currentCost / currentNetWorth));
                    invested = Math.round(s.netWorth * ratio);
                } else {
                    invested = s.netWorth;
                }
            }

            if (profit === undefined || profit === null) {
                profit = s.netWorth - invested;
            }

            pointsMap.set(s.date, {
                date: s.date,
                value: Math.round(s.netWorth),
                invested: Math.round(invested),
                profit: Math.round(profit)
            });
        }

        const today = new Date().toISOString().split('T')[0];

        // Ensure today's live point is included or updated if assets exist
        if (assets.length > 0) {
            pointsMap.set(today, {
                date: today,
                value: Math.round(currentNetWorth),
                invested: Math.round(currentCost),
                profit: Math.round(currentNetWorth - currentCost)
            });
        }

        // 2. Synthesize baseline points from asset purchase dates if snapshots are sparse (<= 2)
        if (assets.length > 0) {
            const sortedAssets = [...assets]
                .filter(a => a.purchaseDate)
                .sort((a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime());

            if (sortedAssets.length > 0) {
                const earliestPurchaseDate = new Date(sortedAssets[0].purchaseDate);
                const earliestSnapshotDate = pointsMap.size > 0 
                    ? new Date(Math.min(...Array.from(pointsMap.keys()).map(d => new Date(d).getTime())))
                    : new Date();

                const daysDiff = (earliestSnapshotDate.getTime() - earliestPurchaseDate.getTime()) / (1000 * 3600 * 24);
                if (pointsMap.size <= 2 || daysDiff > 14) {
                    let cumulativeCost = 0;
                    for (const a of sortedAssets) {
                        const d = new Date(a.purchaseDate);
                        if (isNaN(d.getTime())) continue;
                        const dateStr = d.toISOString().split('T')[0];
                        
                        const fx = this.priceService.isUSAsset(a) ? this.googleFinance.usdToInrRate() : 1;
                        cumulativeCost += a.quantity * a.buyPrice * fx;

                        if (!pointsMap.has(dateStr) && d.getTime() < earliestSnapshotDate.getTime()) {
                            pointsMap.set(dateStr, {
                                date: dateStr,
                                value: Math.round(cumulativeCost),
                                invested: Math.round(cumulativeCost),
                                profit: 0
                            });
                        }
                    }
                }
            }
        }

        return Array.from(pointsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
}
