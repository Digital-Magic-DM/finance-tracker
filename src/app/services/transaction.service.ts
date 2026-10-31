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
} from 'firebase/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { Transaction } from '../models/finance.models';
import { PinSecurityService } from './pin-security.service';

@Injectable({ providedIn: 'root' })
export class TransactionService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private injector = inject(Injector);
    private pinSecurity = inject(PinSecurityService, { optional: true });

    private getCollectionRef() {
        if (this.pinSecurity?.isLocked()) return null;
        const uid = this.auth.currentUser?.uid;
        if (!uid) return null;
        return collection(this.firestore, `users/${uid}/transactions`);
    }

    getTransactions(): Observable<Transaction[]> {
        return new Observable<Transaction[]>(subscriber => {
            runInInjectionContext(this.injector, () => {
                const col = this.getCollectionRef();
                if (!col) { subscriber.next([]); subscriber.complete(); return; }
                const q = query(col, orderBy('date', 'desc'));
                const sub = (collectionData(q, { idField: 'id' }) as Observable<Transaction[]>)
                    .subscribe(subscriber);
                return () => sub.unsubscribe();
            });
        });
    }

    async addTransaction(tx: Omit<Transaction, 'id'>): Promise<void> {
        const col = this.getCollectionRef();
        if (!col) return;
        await addDoc(col, tx as any);
    }

    async updateTransaction(id: string, tx: Partial<Transaction>): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/transactions/${id}`);
        await updateDoc(ref, tx as any);
    }

    async deleteTransaction(id: string): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(this.firestore, `users/${uid}/transactions/${id}`);
        await deleteDoc(ref);
    }

    async batchDeleteTransactions(ids: string[]): Promise<void> {
        const uid = this.auth.currentUser?.uid;
        if (!uid || !ids || ids.length === 0) return;

        const { writeBatch } = await import('firebase/firestore');
        const CHUNK_SIZE = 500;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(this.firestore);
            for (const id of chunk) {
                const ref = doc(this.firestore, `users/${uid}/transactions/${id}`);
                batch.delete(ref);
            }
            await batch.commit();
        }
    }

    async batchAddTransactions(transactions: Omit<Transaction, 'id'>[]): Promise<{ created: number }> {
        const uid = this.auth.currentUser?.uid;
        if (!uid || transactions.length === 0) return { created: 0 };

        const { writeBatch } = await import('firebase/firestore');
        const batch = writeBatch(this.firestore);

        transactions.forEach(tx => {
            const ref = doc(collection(this.firestore, `users/${uid}/transactions`));
            batch.set(ref, {
                ...tx,
                date: tx.date instanceof Date ? tx.date : new Date(tx.date)
            });
        });

        await batch.commit();
        return { created: transactions.length };
    }
}
