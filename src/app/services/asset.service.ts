import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
    Firestore,
    collectionData,
    query,
    orderBy,
} from '@angular/fire/firestore';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
} from 'firebase/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { Asset } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class AssetService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private injector = inject(Injector);


    private getCollectionRef() {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return null;
        return collection(this.firestore, `users/${uid}/assets`);
    }

    getAssets(): Observable<Asset[]> {
        return new Observable<Asset[]>(subscriber => {
            runInInjectionContext(this.injector, () => {
                const col = this.getCollectionRef();
                if (!col) { subscriber.next([]); subscriber.complete(); return; }
                const q = query(col, orderBy('name'));
                const sub = (collectionData(q, { idField: 'id' }) as Observable<Asset[]>)
                    .subscribe(subscriber);
                return () => sub.unsubscribe();
            });
        });
    }

    async addAsset(asset: Omit<Asset, 'id'>): Promise<void> {
        const col = this.getCollectionRef();
        if (!col) throw new Error('User not authenticated');
        await addDoc(col, asset as any);
    }

    async updateAsset(id: string, asset: Partial<Asset>): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) throw new Error('User not authenticated');
        const ref = doc(this.firestore, `users/${uid}/assets/${id}`);
        await updateDoc(ref, asset as any);
    }

    async deleteAsset(id: string): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) throw new Error('User not authenticated');
        const ref = doc(this.firestore, `users/${uid}/assets/${id}`);
        await deleteDoc(ref);
    }

    /**
     * Get a one-time snapshot of the user's assets.
     */
    async getAssetsSnapshot(): Promise<Asset[]> {
        const col = this.getCollectionRef();
        if (!col) return [];
        const snapshot = await getDocs(query(col, orderBy('name')));
        return snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Asset));
    }

    /**
     * Save or update imported assets to Firestore.
     * Supports 'create', 'update', or 'skip' per item.
     */
    async batchSaveAssets(
        items: {
            asset: Omit<Asset, 'id'>;
            existingAsset?: Asset;
            action: 'create' | 'update' | 'skip';
        }[]
    ): Promise<{ created: number; updated: number; skipped: number }> {
        console.log('[AssetService] batchSaveAssets called with', items.length, 'items');

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const item of items) {
            try {
                if (item.action === 'skip') {
                    skipped++;
                    continue;
                }

                if (item.action === 'update' && item.existingAsset?.id) {
                    console.log('[AssetService] Updating existing asset:', item.existingAsset.name);
                    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    await this.updateAsset(item.existingAsset.id, {
                        quantity: item.asset.quantity,
                        buyPrice: item.asset.buyPrice,
                        currentPrice: item.asset.currentPrice || item.existingAsset.currentPrice,
                        lastUpdated: now,
                        lastUpdatedDate: item.asset.lastUpdatedDate || item.existingAsset.lastUpdatedDate,
                        navDate: item.asset.navDate || item.existingAsset.navDate,
                        symbol: item.asset.symbol || item.existingAsset.symbol,
                        currency: item.asset.currency || item.existingAsset.currency,
                        appSource: item.asset.appSource || item.existingAsset.appSource,
                        notes: item.asset.notes || item.existingAsset.notes,
                    });
                    updated++;
                } else {
                    console.log('[AssetService] Creating new asset:', item.asset.name);
                    await this.addAsset(item.asset);
                    created++;
                }
            } catch (err) {
                console.error('[AssetService] Failed to process asset:', item.asset.name, err);
            }
        }

        console.log('[AssetService] Import complete. Created:', created, 'Updated:', updated, 'Skipped:', skipped);
        return { created, updated, skipped };
    }
}
