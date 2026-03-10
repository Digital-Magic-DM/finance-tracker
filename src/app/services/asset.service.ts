import { Injectable, inject, Injector, runInInjectionContext, NgZone } from '@angular/core';
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
} from 'firebase/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { Asset } from '../models/finance.models';

@Injectable({ providedIn: 'root' })
export class AssetService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private injector = inject(Injector);
    private ngZone = inject(NgZone);

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
        if (!col) return;
        await addDoc(col, asset as any);
    }

    async updateAsset(id: string, asset: Partial<Asset>): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/assets/${id}`);
        await updateDoc(ref, asset as any);
    }

    async deleteAsset(id: string): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/assets/${id}`);
        await deleteDoc(ref);
    }

    /**
     * Save imported assets to Firestore.
     * Uses raw Firebase SDK addDoc which resolves properly.
     */
    async batchSaveAssets(assets: Omit<Asset, 'id'>[]): Promise<{ created: number; updated: number }> {
        console.log('[AssetService] batchSaveAssets called with', assets.length, 'assets');

        let created = 0;
        for (const asset of assets) {
            try {
                console.log('[AssetService] Saving:', asset.name);
                await this.addAsset(asset);
                created++;
                console.log('[AssetService] Saved:', asset.name);
            } catch (err) {
                console.error('[AssetService] Failed:', asset.name, err);
            }
        }

        console.log('[AssetService] Import complete. Created:', created);
        return { created, updated: 0 };
    }
}
