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
import { PortfolioSnapshot, Asset, AssetType } from '../models/finance.models';
import { PriceService } from './price.service';
import { GoogleFinanceService } from './google-finance.service';

@Injectable({ providedIn: 'root' })
export class SnapshotService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private injector = inject(Injector);
    private priceService = inject(PriceService);
    private googleFinance = inject(GoogleFinanceService);

    async saveSnapshot(assets: Asset[]): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;

        const today = new Date().toISOString().split('T')[0];
        const breakdown: any = {};
        let totalAssets = 0;

        for (const asset of assets) {
            const cp = asset.currentPrice > 0 ? asset.currentPrice : (asset.type === AssetType.Cash || asset.type === AssetType.RealEstate ? asset.buyPrice : 0);
            const fx = this.priceService.isUSAsset(asset) ? this.googleFinance.usdToInrRate() : 1;
            const value = asset.quantity * cp * fx;
            breakdown[asset.type] = (breakdown[asset.type] || 0) + value;
            totalAssets += value;
        }

        const snapshot: PortfolioSnapshot = {
            date: today,
            netWorth: totalAssets,
            totalAssets,
            totalLiabilities: 0,
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
}
