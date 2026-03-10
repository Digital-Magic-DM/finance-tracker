import { Component, inject, signal, computed, NgZone, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssetService } from '../../services/asset.service';
import { PriceService } from '../../services/price.service';
import { Asset, AssetType, ASSET_COLORS } from '../../models/finance.models';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-assets',
    standalone: true,
    imports: [CurrencyPipe, DecimalPipe, FormsModule],
    templateUrl: './assets.component.html',
    styleUrl: './assets.component.scss',
})
export class AssetsComponent {
    private assetService = inject(AssetService);
    private priceService = inject(PriceService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    assets = toSignal(this.assetService.getAssets(), { initialValue: [] });
    showModal = signal(false);
    editingId = signal<string | null>(null);
    saving = signal(false);
    refreshing = signal(false);
    lastRefreshed = signal<string>('');

    assetTypes = Object.values(AssetType);

    form = signal<Omit<Asset, 'id'>>({
        name: '',
        type: AssetType.Stock,
        quantity: 0,
        buyPrice: 0,
        currentPrice: 0,
        symbol: '',
        currency: 'INR',
        purchaseDate: new Date(),
        notes: '',
    });

    totalValue = computed(() =>
        this.assets().reduce((s, a) => s + a.quantity * a.currentPrice, 0)
    );

    getGain(a: Asset) {
        return (a.currentPrice - a.buyPrice) * a.quantity;
    }

    getGainPct(a: Asset) {
        return a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice) * 100 : 0;
    }

    getAssetValue(a: Asset) {
        return a.quantity * a.currentPrice;
    }

    getColor(type: AssetType) {
        return ASSET_COLORS[type];
    }

    openAdd() {
        this.editingId.set(null);
        this.form.set({
            name: '', type: AssetType.Stock, quantity: 0, buyPrice: 0,
            currentPrice: 0, symbol: '', currency: 'INR', purchaseDate: new Date(), notes: '',
        });
        this.showModal.set(true);
    }

    openEdit(a: Asset) {
        this.editingId.set(a.id!);
        this.form.set({ ...a });
        this.showModal.set(true);
    }

    closeModal() { this.showModal.set(false); }

    updateForm(field: keyof Omit<Asset, 'id'>, value: any) {
        this.form.update((f) => ({ ...f, [field]: value }));
    }

    async save() {
        if (this.saving()) return;
        this.saving.set(true);
        try {
            const id = this.editingId();
            if (id) {
                await this.assetService.updateAsset(id, this.form());
            } else {
                await this.assetService.addAsset(this.form());
            }
            this.closeModal();
        } finally {
            this.saving.set(false);
        }
    }

    async delete(id: string) {
        if (confirm('Delete this asset?')) {
            await this.assetService.deleteAsset(id);
        }
    }

    async refreshPrices() {
        if (this.refreshing()) return;
        this.refreshing.set(true);
        try {
            const count = await this.priceService.refreshAllPrices(this.assets());
            this.ngZone.run(() => {
                this.lastRefreshed.set(new Date().toLocaleTimeString());
                this.refreshing.set(false);
                this.cdr.markForCheck();
            });
        } catch (err) {
            console.error('[Assets] Price refresh failed:', err);
            this.ngZone.run(() => {
                this.refreshing.set(false);
                this.cdr.markForCheck();
            });
        }
    }
}

