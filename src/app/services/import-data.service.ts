import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { AssetService } from './asset.service';
import { Asset, AssetType } from '../models/finance.models';

export type ImportPlatform = 'groww-stock' | 'groww-mf' | 'indmoney' | 'unknown';

export interface ParsedImportRow {
    selected: boolean;
    asset: Omit<Asset, 'id'>;
}

export interface ImportResult {
    platform: ImportPlatform;
    rows: ParsedImportRow[];
}

// ─── Header synonyms for each platform ─────────────────────────────
const GROWW_STOCK_MARKERS = ['stock name', 'quantity', 'avg cost', 'ltp'];
const GROWW_MF_MARKERS = ['scheme name', 'folio number', 'units', 'avg. nav'];
const INDMONEY_MARKERS = ['security name', 'current value', 'invested value'];

// Column synonym maps — used for flexible header matching
const NAME_SYNONYMS = ['stock name', 'scheme name', 'security name', 'company name', 'name of the fund', 'fund name', 'name', 'scrip name'];
const QTY_SYNONYMS = ['quantity', 'units', 'shares', 'qty', 'no. of units', 'no of units', 'total units'];
const BUY_PRICE_SYNONYMS = ['avg cost', 'avg. nav', 'average price', 'buy price', 'purchase nav', 'average cost', 'buy avg', 'avg price', 'invested value'];
const CURRENT_PRICE_SYNONYMS = ['ltp', 'current nav', 'current price', 'market price', 'present nav', 'current value'];
const SYMBOL_SYNONYMS = ['symbol', 'ticker', 'isin', 'nse symbol', 'bse code', 'scrip code', 'nse/bse code'];
const TYPE_SYNONYMS = ['type', 'asset type', 'instrument type', 'segment', 'category', 'instrument'];

@Injectable({ providedIn: 'root' })
export class ImportDataService {
    private assetService = inject(AssetService);

    // ═══════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════

    /**
     * Parse an uploaded Excel / CSV file and return a list of Assets.
     * Automatically detects the platform from the header row.
     */
    async parseFile(file: File): Promise<ImportResult> {
        const data = await this.readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        console.log('[ImportDataService] Total rows read:', allRows.length);
        console.log('[ImportDataService] First 5 rows:', allRows.slice(0, 5));

        // Scan for the real header row (skip summary rows)
        let { headerIndex, headers } = this.findHeaderRow(allRows);

        // Fallback: if no header found, try row 0 as header
        if (headerIndex < 0 && allRows.length > 1) {
            console.warn('[ImportDataService] No header row detected via synonyms. Falling back to row 0 as header.');
            headerIndex = 0;
            headers = allRows[0].map((c: any) => String(c));
        }

        if (headerIndex < 0) {
            console.error('[ImportDataService] File has no usable rows.');
            return { platform: 'unknown', rows: [] };
        }

        console.log('[ImportDataService] Header row index:', headerIndex);
        console.log('[ImportDataService] Headers:', headers);

        const platform = this.detectPlatform(headers);
        console.log('[ImportDataService] Detected platform:', platform);

        const dataRows = allRows.slice(headerIndex + 1)
            .filter(row => row.some((cell: any) => cell !== '' && cell != null)); // skip fully empty rows
        console.log('[ImportDataService] Data rows count:', dataRows.length);

        let assets: Omit<Asset, 'id'>[];
        switch (platform) {
            case 'groww-stock':
                assets = this.parseGrowwStocks(headers, dataRows);
                break;
            case 'groww-mf':
                assets = this.parseGrowwMutualFunds(headers, dataRows);
                break;
            case 'indmoney':
                assets = this.parseINDmoney(headers, dataRows);
                break;
            default:
                // Fall back to generic parsing
                assets = this.parseGeneric(headers, dataRows);
                break;
        }

        console.log('[ImportDataService] Parsed assets count:', assets.length);
        if (assets.length > 0) {
            console.log('[ImportDataService] First asset:', assets[0]);
        }

        // Group duplicates (same name → sum quantities)
        assets = this.groupDuplicates(assets);

        const rows: ParsedImportRow[] = assets.map(a => ({ selected: true, asset: a }));
        return { platform, rows };
    }

    /**
     * Detect the platform from a set of header strings.
     */
    detectPlatform(headers: string[]): ImportPlatform {
        const lower = headers.map(h => String(h).toLowerCase().trim());

        const growwStockScore = GROWW_STOCK_MARKERS.filter(m => lower.some(h => h.includes(m))).length;
        const growwMfScore = GROWW_MF_MARKERS.filter(m => lower.some(h => h.includes(m))).length;
        const indmoneyScore = INDMONEY_MARKERS.filter(m => lower.some(h => h.includes(m))).length;

        const maxScore = Math.max(growwStockScore, growwMfScore, indmoneyScore);
        if (maxScore < 2) return 'unknown';

        if (growwStockScore === maxScore) return 'groww-stock';
        if (growwMfScore === maxScore) return 'groww-mf';
        return 'indmoney';
    }

    /**
     * Save selected assets to Firestore using batch writes with dedup.
     * Returns { created, updated } counts.
     */
    async importAssets(rows: ParsedImportRow[]): Promise<{ created: number; updated: number }> {
        console.log('importAssets calleds', rows)
        const selected = rows.filter(r => r.selected).map(r => r.asset);
        return this.assetService.batchSaveAssets(selected);
    }

    // ═══════════════════════════════════════════
    //  PLATFORM-SPECIFIC PARSERS
    // ═══════════════════════════════════════════

    parseGrowwStocks(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const nameIdx = this.findCol(headers, NAME_SYNONYMS);
        const qtyIdx = this.findCol(headers, QTY_SYNONYMS);
        const buyIdx = this.findCol(headers, BUY_PRICE_SYNONYMS);
        const curIdx = this.findCol(headers, CURRENT_PRICE_SYNONYMS);
        const symIdx = this.findCol(headers, SYMBOL_SYNONYMS);

        return this.mapRows(rows, nameIdx, qtyIdx, buyIdx, curIdx, symIdx, AssetType.Stock, 'Groww');
    }

    parseGrowwMutualFunds(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const nameIdx = this.findCol(headers, NAME_SYNONYMS);
        const qtyIdx = this.findCol(headers, QTY_SYNONYMS);
        const buyIdx = this.findCol(headers, BUY_PRICE_SYNONYMS);
        const curIdx = this.findCol(headers, CURRENT_PRICE_SYNONYMS);
        const symIdx = this.findCol(headers, SYMBOL_SYNONYMS);

        return this.mapRows(rows, nameIdx, qtyIdx, buyIdx, curIdx, symIdx, AssetType.MutualFund, 'Groww');
    }

    parseINDmoney(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const nameIdx = this.findCol(headers, NAME_SYNONYMS);
        const qtyIdx = this.findCol(headers, QTY_SYNONYMS);
        const buyIdx = this.findCol(headers, BUY_PRICE_SYNONYMS);
        const curIdx = this.findCol(headers, CURRENT_PRICE_SYNONYMS);
        const symIdx = this.findCol(headers, SYMBOL_SYNONYMS);
        const typeIdx = this.findCol(headers, TYPE_SYNONYMS);

        const assets: Omit<Asset, 'id'>[] = [];
        for (const row of rows) {
            const name = this.str(row[nameIdx]);
            if (!name) continue;

            assets.push({
                name,
                type: this.inferType(row, typeIdx, name),
                quantity: qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0,
                buyPrice: buyIdx >= 0 ? this.num(row[buyIdx]) : 0,
                currentPrice: curIdx >= 0 ? this.num(row[curIdx]) : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                notes: 'Imported from INDmoney',
            });
        }
        return assets;
    }

    // ═══════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════

    /**
     * Scan all rows to find the first row that looks like a header.
     * A "header row" is one where ≥ 2 cells match our known column synonyms.
     */
    private findHeaderRow(allRows: any[][]): { headerIndex: number; headers: string[] } {
        const allSynonyms = [
            ...NAME_SYNONYMS, ...QTY_SYNONYMS, ...BUY_PRICE_SYNONYMS,
            ...CURRENT_PRICE_SYNONYMS, ...SYMBOL_SYNONYMS, ...TYPE_SYNONYMS,
        ];

        for (let i = 0; i < Math.min(allRows.length, 30); i++) {
            const row = allRows[i];
            if (!row || row.length < 2) continue;

            const lower = row.map((c: any) => String(c).toLowerCase().trim());
            const matchCount = lower.filter(cell =>
                allSynonyms.some(syn => cell.includes(syn))
            ).length;

            if (matchCount >= 2) {
                return { headerIndex: i, headers: row.map((c: any) => String(c)) };
            }
        }
        return { headerIndex: -1, headers: [] };
    }

    /** Generic parser when platform can't be determined but headers are recognizable */
    private parseGeneric(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const nameIdx = this.findCol(headers, NAME_SYNONYMS);
        const qtyIdx = this.findCol(headers, QTY_SYNONYMS);
        const buyIdx = this.findCol(headers, BUY_PRICE_SYNONYMS);
        const curIdx = this.findCol(headers, CURRENT_PRICE_SYNONYMS);
        const symIdx = this.findCol(headers, SYMBOL_SYNONYMS);
        const typeIdx = this.findCol(headers, TYPE_SYNONYMS);

        const assets: Omit<Asset, 'id'>[] = [];
        for (const row of rows) {
            const name = this.str(row[nameIdx]);
            if (!name) continue;

            assets.push({
                name,
                type: this.inferType(row, typeIdx, name),
                quantity: qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0,
                buyPrice: buyIdx >= 0 ? this.num(row[buyIdx]) : 0,
                currentPrice: curIdx >= 0 ? this.num(row[curIdx]) : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                notes: 'Imported from CSV',
            });
        }
        return assets;
    }

    /** Map rows to Asset[] using column indices and a default type */
    private mapRows(
        rows: any[][], nameIdx: number, qtyIdx: number, buyIdx: number,
        curIdx: number, symIdx: number, defaultType: AssetType, source: string,
    ): Omit<Asset, 'id'>[] {
        const assets: Omit<Asset, 'id'>[] = [];
        for (const row of rows) {
            const name = nameIdx >= 0 ? this.str(row[nameIdx]) : '';
            if (!name) continue;

            assets.push({
                name,
                type: defaultType,
                quantity: qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0,
                buyPrice: buyIdx >= 0 ? this.num(row[buyIdx]) : 0,
                currentPrice: curIdx >= 0 ? this.num(row[curIdx]) : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                notes: `Imported from ${source}`,
            });
        }
        return assets;
    }

    /** Find column index by synonym list */
    private findCol(headers: string[], synonyms: string[]): number {
        const lower = headers.map(h => String(h).toLowerCase().trim());
        for (const syn of synonyms) {
            const idx = lower.findIndex(h => h.includes(syn));
            if (idx >= 0) return idx;
        }
        return -1;
    }

    /** Infer asset type from a type column value or name heuristics */
    private inferType(row: any[], typeIdx: number, name: string): AssetType {
        if (typeIdx >= 0) {
            const val = String(row[typeIdx]).toLowerCase();
            if (val.includes('mutual') || val.includes('mf') || val.includes('fund')) return AssetType.MutualFund;
            if (val.includes('etf')) return AssetType.ETF;
            if (val.includes('stock') || val.includes('equity') || val.includes('share')) return AssetType.Stock;
            if (val.includes('gold')) return AssetType.Gold;
        }
        // Heuristic from name
        const lower = name.toLowerCase();
        if (lower.includes('fund') || lower.includes('scheme') || lower.includes('nifty') || lower.includes('sensex')) {
            if (lower.includes('etf') || lower.includes('exchange traded')) return AssetType.ETF;
            return AssetType.MutualFund;
        }
        return AssetType.Stock;
    }

    /** Group assets with the same name — sum their quantities, keep the latest prices */
    private groupDuplicates(assets: Omit<Asset, 'id'>[]): Omit<Asset, 'id'>[] {
        const map = new Map<string, Omit<Asset, 'id'>>();
        for (const a of assets) {
            const key = (a.symbol?.toLowerCase()) || a.name.toLowerCase();
            const existing = map.get(key);
            if (existing) {
                existing.quantity += a.quantity;
                // Weighted average buy price
                const totalCost = existing.buyPrice * (existing.quantity - a.quantity) + a.buyPrice * a.quantity;
                existing.buyPrice = existing.quantity > 0 ? totalCost / existing.quantity : 0;
                if (a.currentPrice) existing.currentPrice = a.currentPrice;
            } else {
                map.set(key, { ...a });
            }
        }
        return Array.from(map.values());
    }

    /** Normalize a cell to a trimmed string */
    private str(val: any): string {
        return val == null ? '' : String(val).trim();
    }

    /** Normalize a cell to a number — strips commas, ₹, whitespace */
    private num(val: any): number {
        if (val == null) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(String(val).replace(/[₹,\s]/g, '')) || 0;
    }

    /** Read file as ArrayBuffer for xlsx */
    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }
}
