import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import { AssetService } from './asset.service';
import { Asset, AssetType } from '../models/finance.models';
import { TickerRegistryService } from './ticker-registry.service';

// Configure PDF.js worker
// @ts-ignore - The dynamic import warning is suppressed for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export type ImportPlatform = 'groww-stock' | 'groww-mf' | 'indmoney' | 'indmoney-us' | 'indmoney-pdf' | 'cdsl-pdf' | 'unknown';

export interface ParsedImportRow {
    selected: boolean;
    asset: Omit<Asset, 'id'>;
    existingAsset?: Asset;
    isDuplicate?: boolean;
}

export interface ImportResult {
    platform: ImportPlatform;
    rows: ParsedImportRow[];
}

// ─── Popular US Stocks and ETFs Dictionary ─────────────────────────
export const US_STOCK_NAMES: Record<string, string> = {
    AAPL: 'Apple Inc.',
    MSFT: 'Microsoft Corp.',
    GOOGL: 'Alphabet Inc. (Google)',
    GOOG: 'Alphabet Inc. (Google)',
    AMZN: 'Amazon.com Inc.',
    NVDA: 'NVIDIA Corp.',
    META: 'Meta Platforms Inc.',
    TSLA: 'Tesla Inc.',
    BLK: 'BlackRock Inc.',
    IBM: 'IBM Corp.',
    BRK_A: 'Berkshire Hathaway Inc.',
    BRK_B: 'Berkshire Hathaway Inc.',
    JNJ: 'Johnson & Johnson',
    V: 'Visa Inc.',
    MA: 'Mastercard Inc.',
    PG: 'Procter & Gamble Co.',
    JPM: 'JPMorgan Chase & Co.',
    UNH: 'UnitedHealth Group',
    HD: 'The Home Depot',
    CVX: 'Chevron Corp.',
    XOM: 'Exxon Mobil Corp.',
    ABBV: 'AbbVie Inc.',
    LLY: 'Eli Lilly and Company',
    KO: 'The Coca-Cola Company',
    PEP: 'PepsiCo Inc.',
    COST: 'Costco Wholesale Corp.',
    AVGO: 'Broadcom Inc.',
    WMT: 'Walmart Inc.',
    MCD: 'McDonald\'s Corp.',
    CSCO: 'Cisco Systems Inc.',
    TMO: 'Thermo Fisher Scientific',
    ABT: 'Abbott Laboratories',
    DIS: 'The Walt Disney Company',
    NFLX: 'Netflix Inc.',
    AMD: 'Advanced Micro Devices Inc.',
    INTC: 'Intel Corp.',
    QCOM: 'Qualcomm Inc.',
    TXN: 'Texas Instruments',
    CRM: 'Salesforce Inc.',
    ORCL: 'Oracle Corp.',
    ADBE: 'Adobe Inc.',
    PYPL: 'PayPal Holdings Inc.',
    COIN: 'Coinbase Global Inc.',
    UBER: 'Uber Technologies Inc.',
    ABNB: 'Airbnb Inc.',
    PLTR: 'Palantir Technologies',
    SNOW: 'Snowflake Inc.',
    SQ: 'Block Inc. (Square)',
    SHOP: 'Shopify Inc.',
    BABA: 'Alibaba Group',
    NKE: 'NIKE Inc.',
    SBUX: 'Starbucks Corp.',
    BA: 'The Boeing Company',
    GE: 'General Electric',
    CAT: 'Caterpillar Inc.',
    GS: 'Goldman Sachs Group',
    MS: 'Morgan Stanley',
    BAC: 'Bank of America Corp.',
    C: 'Citigroup Inc.',
    WFC: 'Wells Fargo & Co.',
    TSM: 'Taiwan Semiconductor Manufacturing',
    ARM: 'Arm Holdings plc',
    ASML: 'ASML Holding N.V.',
    SMCI: 'Super Micro Computer Inc.',
    PANW: 'Palo Alto Networks',
    CRWD: 'CrowdStrike Holdings',
    NET: 'Cloudflare Inc.',
    NOW: 'ServiceNow Inc.',
    INTU: 'Intuit Inc.',
    // Popular US ETFs
    SPY: 'SPDR S&P 500 ETF Trust',
    VOO: 'Vanguard S&P 500 ETF',
    IVV: 'iShares Core S&P 500 ETF',
    QQQ: 'Invesco QQQ Trust (Nasdaq 100)',
    VTI: 'Vanguard Total Stock Market ETF',
    DIA: 'SPDR Dow Jones Industrial Average ETF',
    IWM: 'iShares Russell 2000 ETF',
    VT: 'Vanguard Total World Stock ETF',
    VEA: 'Vanguard FTSE Developed Markets ETF',
    VWO: 'Vanguard FTSE Emerging Markets ETF',
    XLK: 'Technology Select Sector SPDR Fund',
    XLF: 'Financial Select Sector SPDR Fund',
    XLV: 'Health Care Select Sector SPDR Fund',
    XLE: 'Energy Select Sector SPDR Fund',
    XLI: 'Industrial Select Sector SPDR Fund',
    XLP: 'Consumer Staples Select Sector SPDR',
    XLY: 'Consumer Discretionary Select SPDR',
    SCHD: 'Schwab U.S. Dividend Equity ETF',
    JEPI: 'JPMorgan Equity Premium Income ETF',
    ARKK: 'ARK Innovation ETF',
    SOXX: 'iShares Semiconductor ETF',
    SMH: 'VanEck Semiconductor ETF',
    TLT: 'iShares 20+ Year Treasury Bond ETF',
    GLD: 'SPDR Gold Shares',
    SLV: 'iShares Silver Trust',
    VNQ: 'Vanguard Real Estate ETF',
    BND: 'Vanguard Total Bond Market ETF',
};

// ─── Header synonyms for each platform ─────────────────────────────
const GROWW_STOCK_MARKERS = ['stock name', 'quantity', 'avg cost', 'ltp', 'average buy price', 'closing price'];
const GROWW_MF_MARKERS = ['scheme name', 'units', 'invested value', 'current value', 'amc', 'category'];
const INDMONEY_MARKERS = ['stock name', 'isin', 'quantity', 'average buy price'];

// Rows whose first non-empty cell matches these are summary/footer rows → skip them
const SUMMARY_ROW_KEYWORDS = ['invested value', 'current value', 'returns', 'xirr', 'total', 'grand total', 'overall'];

// Column synonym maps — used for flexible header matching
const NAME_SYNONYMS = ['stock name', 'scheme name', 'security name', 'company name', 'name of the fund', 'fund name', 'name', 'scrip name', 'stock symbol'];
const QTY_SYNONYMS = ['quantity', 'units', 'shares', 'qty', 'no. of units', 'no of units', 'total units'];
const BUY_PRICE_SYNONYMS = ['avg cost', 'avg. nav', 'average price', 'average buy price', 'buy price', 'purchase nav', 'average cost', 'buy avg', 'avg price', 'invested value', 'avg. price', 'avg. price ($)', 'avg price ($)'];
const CURRENT_PRICE_SYNONYMS = ['ltp', 'current nav', 'current price', 'closing price', 'market price', 'present nav', 'current value', 'total value', 'total value ($)'];
const SYMBOL_SYNONYMS = ['stock symbol', 'symbol', 'ticker', 'isin', 'nse symbol', 'bse code', 'scrip code', 'nse/bse code'];
const TYPE_SYNONYMS = ['type', 'asset type', 'instrument type', 'segment', 'category', 'instrument', 'amc'];

@Injectable({ providedIn: 'root' })
export class ImportDataService {
    private assetService = inject(AssetService);
    private tickerRegistry = inject(TickerRegistryService);

    // ═══════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════

    /**
     * Parse an uploaded Excel / CSV / PDF file and return a list of Assets.
     * Automatically detects the platform and format.
     */
    async parseFile(file: File): Promise<ImportResult> {
        // Ensure ticker registry is loaded on demand for ticker/ISIN mapping
        await this.tickerRegistry.ensureLoaded();

        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'pdf' || file.type === 'application/pdf') {
            return this.parsePdf(file);
        }

        const data = await this.readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // Check for INDmoney US Stocks statement (Alpaca / US holdings)
        if (this.isINDmoneyUSReport(allRows)) {
            let { headerIndex, headers } = this.findHeaderRow(allRows);
            if (headerIndex < 0) {
                // Find row with 'stock symbol'
                for (let i = 0; i < Math.min(allRows.length, 15); i++) {
                    const rowLower = (allRows[i] || []).map((c: any) => String(c).toLowerCase().trim());
                    if (rowLower.some(c => c.includes('stock symbol'))) {
                        headerIndex = i;
                        headers = allRows[i].map((c: any) => String(c));
                        break;
                    }
                }
            }

            if (headerIndex >= 0) {
                const rawDataRows = allRows.slice(headerIndex + 1);
                const assets = this.parseINDmoneyUS(headers, rawDataRows);
                const grouped = this.groupDuplicates(assets);
                const rows: ParsedImportRow[] = grouped.map(a => ({ selected: true, asset: a }));
                return { platform: 'indmoney-us', rows };
            }
        }

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

        const platform = this.detectPlatform(headers);

        // Take rows and skip empty ones
        const rawDataRows = allRows.slice(headerIndex + 1);
        const dataRows: any[][] = [];
        for (const row of rawDataRows) {
            const hasContent = row.some((cell: any) => cell !== '' && cell != null);
            if (!hasContent) continue; // skip empty rows

            // Skip summary / footer rows
            const firstCell = String(row.find((c: any) => c !== '' && c != null) ?? '').toLowerCase().trim();
            if (SUMMARY_ROW_KEYWORDS.some(kw => firstCell === kw || firstCell.startsWith(kw))) continue;

            dataRows.push(row);
        }

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
     * Compare parsed rows against existing portfolio assets to identify duplicates.
     */
    matchWithExisting(rows: ParsedImportRow[], existingAssets: Asset[]): ParsedImportRow[] {
        return rows.map(r => {
            const match = existingAssets.find(exist => isAssetMatch(r.asset, exist));
            return {
                ...r,
                existingAsset: match,
                isDuplicate: !!match
            };
        });
    }

    /**
     * Save selected assets to Firestore using update, create, or skip based on duplicateMode.
     * Returns { created, updated, skipped } counts.
     */
    async importAssets(
        rows: ParsedImportRow[],
        duplicateMode: 'update' | 'create' | 'skip' = 'update'
    ): Promise<{ created: number; updated: number; skipped: number }> {
        const items = rows
            .filter(r => r.selected)
            .map(r => {
                let action: 'create' | 'update' | 'skip' = 'create';
                if (r.isDuplicate && r.existingAsset) {
                    action = duplicateMode;
                }
                return {
                    asset: r.asset,
                    existingAsset: r.existingAsset,
                    action
                };
            });

        return this.assetService.batchSaveAssets(items);
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

        return this.mapRows(headers, rows, nameIdx, qtyIdx, buyIdx, curIdx, symIdx, AssetType.Stock, 'Groww');
    }

    parseGrowwMutualFunds(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const nameIdx = this.findCol(headers, NAME_SYNONYMS);
        const qtyIdx = this.findCol(headers, QTY_SYNONYMS);
        const buyIdx = this.findCol(headers, BUY_PRICE_SYNONYMS);
        const curIdx = this.findCol(headers, CURRENT_PRICE_SYNONYMS);
        const symIdx = this.findCol(headers, SYMBOL_SYNONYMS);

        return this.mapRows(headers, rows, nameIdx, qtyIdx, buyIdx, curIdx, symIdx, AssetType.MutualFund, 'Groww');
    }

    private isTotalValueHeader(header: string): boolean {
        if (!header) return false;
        const h = header.toLowerCase().trim();
        return h.includes('invested value') ||
            h.includes('invested amount') ||
            h.includes('amount invested') ||
            h.includes('cost value') ||
            h.includes('total cost') ||
            h.includes('current value') ||
            h.includes('market value') ||
            h.includes('total value') ||
            h.includes('present value') ||
            h === 'invested' ||
            h === 'current';
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

            const quantity = qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0;
            let buyPrice = buyIdx >= 0 ? this.num(row[buyIdx]) : 0;
            if (buyIdx >= 0 && headers[buyIdx] && this.isTotalValueHeader(headers[buyIdx]) && quantity > 0) {
                buyPrice = buyPrice / quantity;
            }

            let currentPrice = curIdx >= 0 ? this.num(row[curIdx]) : 0;
            if (curIdx >= 0 && headers[curIdx] && this.isTotalValueHeader(headers[curIdx]) && quantity > 0) {
                currentPrice = currentPrice / quantity;
            }

            assets.push({
                name,
                type: this.inferType(row, typeIdx, name),
                quantity,
                buyPrice,
                currentPrice: currentPrice > 0 ? currentPrice : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                appSource: 'INDmoney',
                notes: 'Imported from INDmoney',
            });
        }
        return assets;
    }

    /**
     * Check if the sheet contents belong to an INDmoney US stocks holding report.
     */
    private isINDmoneyUSReport(allRows: any[][]): boolean {
        for (let i = 0; i < Math.min(allRows.length, 15); i++) {
            const rowStr = (allRows[i] || []).map((c: any) => String(c).toLowerCase().trim()).join(' ');
            if (
                rowStr.includes('alpaca') ||
                rowStr.includes('us broker') ||
                (rowStr.includes('stock symbol') && (rowStr.includes('avg. price') || rowStr.includes('holding since') || rowStr.includes('total value')))
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parse INDmoney US stocks holding reports (e.g. from Alpaca broker).
     */
    parseINDmoneyUS(headers: string[], rows: any[][]): Omit<Asset, 'id'>[] {
        const symIdx = this.findCol(headers, ['stock symbol', 'symbol', 'ticker']);
        const qtyIdx = this.findCol(headers, ['quantity', 'units', 'qty', 'shares']);
        const buyIdx = this.findCol(headers, ['avg. price', 'avg price', 'average price', 'buy price', 'cost per share', 'purchase price']);
        const curIdx = this.findCol(headers, ['current price', 'closing price', 'market price', 'last price', 'ltp', 'cmp']);
        const investedIdx = this.findCol(headers, ['invested value', 'invested amount', 'amount invested', 'total cost', 'cost value']);
        const totalIdx = this.findCol(headers, ['total value', 'current value', 'market value', 'present value']);
        const sinceIdx = this.findCol(headers, ['holding since', 'date', 'purchase date']);

        const assets: Omit<Asset, 'id'>[] = [];
        for (const row of rows) {
            if (!row || row.length === 0) continue;
            const symbol = symIdx >= 0 ? this.str(row[symIdx]).toUpperCase().trim() : '';
            if (!symbol || symbol.includes('DISCLAIMER') || symbol.startsWith('*') || symbol.includes('ACCOUNT DETAILS')) continue;

            const quantity = qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0;
            if (quantity <= 0) continue;

            let buyPrice = buyIdx >= 0 ? this.num(row[buyIdx]) : 0;
            if (buyIdx >= 0 && headers[buyIdx] && this.isTotalValueHeader(headers[buyIdx]) && quantity > 0) {
                buyPrice = buyPrice / quantity;
            }
            let investedVal = investedIdx >= 0 ? this.num(row[investedIdx]) : 0;
            if (buyPrice === 0 && investedVal > 0 && quantity > 0) {
                buyPrice = investedVal / quantity;
            }

            let currentPrice = curIdx >= 0 ? this.num(row[curIdx]) : 0;
            if (curIdx >= 0 && headers[curIdx] && this.isTotalValueHeader(headers[curIdx]) && quantity > 0) {
                currentPrice = currentPrice / quantity;
            }
            let currentVal = totalIdx >= 0 ? this.num(row[totalIdx]) : 0;
            if (currentPrice === 0 && currentVal > 0 && quantity > 0) {
                currentPrice = currentVal / quantity;
            }

            let purchaseDate = new Date();
            if (sinceIdx >= 0 && row[sinceIdx]) {
                const parsedDate = new Date(row[sinceIdx]);
                if (!isNaN(parsedDate.getTime())) {
                    purchaseDate = parsedDate;
                }
            }

            const cleanSym = symbol.replace(/^(NASDAQ:|NYSE:|NYSEARCA:)/, '').replace(/\.(US|O|N)$/, '');
            const isETF = [
                'SPY', 'VOO', 'IVV', 'QQQ', 'VTI', 'DIA', 'IWM', 'VT', 'VEA', 'VWO',
                'XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLP', 'XLY', 'SCHD', 'JEPI',
                'ARKK', 'SOXX', 'SMH', 'TLT', 'GLD', 'SLV', 'VNQ', 'BND'
            ].includes(cleanSym) || cleanSym.endsWith('ETF');
            const name = US_STOCK_NAMES[cleanSym] || (isETF ? `${cleanSym} ETF` : `${cleanSym} Stock`);

            assets.push({
                name,
                symbol: cleanSym,
                type: isETF ? AssetType.ETF : AssetType.USStock,
                quantity,
                buyPrice,
                currentPrice: currentPrice > 0 ? currentPrice : buyPrice,
                currency: 'USD',
                purchaseDate,
                appSource: 'INDmoney',
                notes: 'Imported from INDmoney (US Stocks)',
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

            const quantity = qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0;
            let buyPrice = buyIdx >= 0 ? this.num(row[buyIdx]) : 0;
            if (buyIdx >= 0 && headers[buyIdx] && this.isTotalValueHeader(headers[buyIdx]) && quantity > 0) {
                buyPrice = buyPrice / quantity;
            }

            let currentPrice = curIdx >= 0 ? this.num(row[curIdx]) : 0;
            if (curIdx >= 0 && headers[curIdx] && this.isTotalValueHeader(headers[curIdx]) && quantity > 0) {
                currentPrice = currentPrice / quantity;
            }

            assets.push({
                name,
                type: this.inferType(row, typeIdx, name),
                quantity,
                buyPrice,
                currentPrice: currentPrice > 0 ? currentPrice : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                appSource: 'CSV Import',
                notes: 'Imported from CSV',
            });
        }
        return assets;
    }

    /** Map rows to Asset[] using column indices and a default type */
    private mapRows(
        headers: string[], rows: any[][], nameIdx: number, qtyIdx: number, buyIdx: number,
        curIdx: number, symIdx: number, defaultType: AssetType, source: string,
    ): Omit<Asset, 'id'>[] {
        const assets: Omit<Asset, 'id'>[] = [];
        for (const row of rows) {
            const name = nameIdx >= 0 ? this.str(row[nameIdx]) : '';
            if (!name) continue;

            const quantity = qtyIdx >= 0 ? this.num(row[qtyIdx]) : 0;
            let buyPrice = buyIdx >= 0 ? this.num(row[buyIdx]) : 0;
            if (buyIdx >= 0 && headers[buyIdx] && this.isTotalValueHeader(headers[buyIdx]) && quantity > 0) {
                buyPrice = buyPrice / quantity;
            }

            let currentPrice = curIdx >= 0 ? this.num(row[curIdx]) : 0;
            if (curIdx >= 0 && headers[curIdx] && this.isTotalValueHeader(headers[curIdx]) && quantity > 0) {
                currentPrice = currentPrice / quantity;
            }

            let type = defaultType;
            if (name.toUpperCase().includes(' ETF') || name.toUpperCase().endsWith(' ETF')) {
                type = AssetType.ETF;
            }

            assets.push({
                name,
                type,
                quantity,
                buyPrice,
                currentPrice: currentPrice > 0 ? currentPrice : 0,
                symbol: symIdx >= 0 ? this.str(row[symIdx]) : '',
                currency: 'INR',
                purchaseDate: new Date(),
                appSource: source,
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
            if (val.includes('fixed deposit') || val.includes('term deposit') || val.includes(' fd') || val === 'fd') return AssetType.FixedDeposit;
            if (val.includes('bond') || val.includes('debenture') || val.includes('g-sec') || val.includes('gsec') || val.includes('ncd') || val.includes('sgb') || val.includes('treasury')) return AssetType.Bond;
            if (val.includes('us stock') || val.includes('us equity')) return AssetType.USStock;
            if (val.includes('mutual') || val.includes('mf') || val.includes('fund')) return AssetType.MutualFund;
            if (val.includes('etf')) return AssetType.ETF;
            if (val.includes('stock') || val.includes('equity') || val.includes('share')) return AssetType.Stock;
            if (val.includes('gold')) return AssetType.Gold;
        }
        // Heuristic from name
        const lower = name.toLowerCase();
        if (lower.includes('savings account') || lower.includes('bank account') || lower.includes('savings bank') || lower.includes('salary account')) return AssetType.SavingsAccount;
        if (lower.includes('fixed deposit') || lower.includes('term deposit') || lower.includes(' fd') || lower.endsWith(' fd')) return AssetType.FixedDeposit;
        if (lower.includes('bond') || lower.includes('sgb') || lower.includes('debenture') || lower.includes('g-sec') || lower.includes('gsec') || lower.includes('ncd')) return AssetType.Bond;
        if (lower.includes('fund') || lower.includes('scheme') || lower.includes('amc')) {
            if (lower.includes('etf') || lower.includes('exchange traded')) return AssetType.ETF;
            return AssetType.MutualFund;
        }
        if (lower.includes('etf')) return AssetType.ETF;
        return AssetType.Stock;
    }

    /** Group assets with the same name — sum their quantities, recalculate weighted-avg buy price */
    /**
     * Parse a PDF holding statement (INDmoney, CDSL, NSDL, etc.).
     */
    async parsePdf(file: File): Promise<ImportResult> {
        await this.tickerRegistry.ensureLoaded();
        const data = await this.readFileAsArrayBuffer(file);
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
        const pdf = await loadingTask.promise;

        const rawLines: string[] = [];
        let fullPdfText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = (textContent.items as any[])
                .map(it => ({
                    str: it.str.trim(),
                    raw: it.str,
                    x: it.transform[4],
                    y: Math.round(it.transform[5])
                }))
                .filter(it => it.raw.length > 0);

            // Group text items within 3px y tolerance
            const lineGroups = new Map<number, any[]>();
            for (const item of items) {
                let foundKey: number | null = null;
                for (const key of lineGroups.keys()) {
                    if (Math.abs(key - item.y) <= 3) {
                        foundKey = key;
                        break;
                    }
                }
                if (foundKey !== null) {
                    lineGroups.get(foundKey)!.push(item);
                } else {
                    lineGroups.set(item.y, [item]);
                }
            }

            const sortedY = Array.from(lineGroups.keys()).sort((a, b) => b - a);
            for (const y of sortedY) {
                const rowItems = lineGroups.get(y)!.sort((a, b) => a.x - b.x);
                const lineStr = rowItems.map(it => it.str).filter(Boolean).join(' ');
                rawLines.push(lineStr);
                fullPdfText += ' ' + lineStr;
            }
        }

        // Platform detection
        const lowerText = fullPdfText.toLowerCase();
        let platform: ImportPlatform = 'indmoney-pdf';
        if (lowerText.includes('indstocks') || lowerText.includes('indmoney')) {
            platform = 'indmoney-pdf';
        } else if (lowerText.includes('cdsl') || lowerText.includes('nsdl')) {
            platform = 'cdsl-pdf';
        }

        const ISIN_ROW_REGEX = /^(\d+)?\s*(IN[E|F|0-9][A-Z0-9]{9})\b\s*(.+)$/;
        const parsedHoldings: { isin: string; name: string; qty: number; rate: number }[] = [];
        let current: { isin: string; name: string; qty: number; rate: number } | null = null;

        for (const line of rawLines) {
            const match = line.match(ISIN_ROW_REGEX);
            if (match) {
                if (current) parsedHoldings.push(current);
                const isin = match[2];
                const rest = match[3].trim();

                // Numbers at the end of the line: [freeBal, totQty, rate, value] OR [totQty, rate, value] OR [qty, rate]
                const numMatches4 = rest.match(/([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
                let qty = 0;
                let rate = 0;
                let namePart = '';

                if (numMatches4) {
                    qty = parseFloat(numMatches4[2].replace(/,/g, '')) || 0;
                    rate = parseFloat(numMatches4[3].replace(/,/g, '')) || 0;
                    namePart = rest.slice(0, rest.length - numMatches4[0].length).trim();
                } else {
                    const numMatches3 = rest.match(/([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
                    if (numMatches3) {
                        qty = parseFloat(numMatches3[1].replace(/,/g, '')) || 0;
                        rate = parseFloat(numMatches3[2].replace(/,/g, '')) || 0;
                        namePart = rest.slice(0, rest.length - numMatches3[0].length).trim();
                    } else {
                        const numMatches2 = rest.match(/([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
                        if (numMatches2) {
                            qty = parseFloat(numMatches2[1].replace(/,/g, '')) || 0;
                            rate = parseFloat(numMatches2[2].replace(/,/g, '')) || 0;
                            namePart = rest.slice(0, rest.length - numMatches2[0].length).trim();
                        } else {
                            namePart = rest;
                        }
                    }
                }

                current = { isin, name: namePart, qty, rate };
            } else if (current && !line.startsWith('Total') && !line.startsWith('Rights') && !line.startsWith('Page') && !line.includes('DEPOSITORY')) {
                // Continuation line of multi-line company name
                const trimmed = line.trim();
                if (trimmed && !trimmed.match(/^(\d+\.?|\d+:\d+|\*+|\d{6,})$/)) {
                    if (current.name.endsWith('-')) {
                        current.name = current.name.slice(0, -1) + trimmed;
                    } else {
                        current.name += ' ' + trimmed;
                    }
                }
            } else if (line.startsWith('Total')) {
                if (current) {
                    parsedHoldings.push(current);
                    current = null;
                }
            }
        }
        if (current) parsedHoldings.push(current);

        let assets: Omit<Asset, 'id'>[] = parsedHoldings.map(item => {
            const mappedTicker = this.tickerRegistry.lookupIsin(item.isin) || '';
            const cleanSym = mappedTicker.replace(/\.(NS|BO)$/, '') || item.isin;
            const formattedName = this.formatCompanyName(item.name, cleanSym);
            const isMf = item.isin.startsWith('INF');
            const isEtf = formattedName.toUpperCase().includes('ETF') || cleanSym.toUpperCase().endsWith('BEES');

            const appName = platform === 'indmoney-pdf' ? 'INDmoney' : 'CDSL / NSDL';
            return {
                name: formattedName,
                type: isMf ? AssetType.MutualFund : (isEtf ? AssetType.ETF : AssetType.Stock),
                quantity: item.qty,
                buyPrice: item.rate,
                currentPrice: 0,
                symbol: cleanSym,
                currency: 'INR',
                purchaseDate: new Date(),
                appSource: appName,
                notes: `Imported from ${appName} (ISIN: ${item.isin})`,
            };
        });

        // Group duplicates if any
        assets = this.groupDuplicates(assets);

        const rows: ParsedImportRow[] = assets.map(a => ({ selected: true, asset: a }));
        return { platform, rows };
    }

    /**
     * Nicely format company names from depository uppercase holding statements.
     * e.g. "RESTAURANT BRANDS ASIA LIM-ITED" -> "Restaurant Brands Asia Ltd"
     * e.g. "CENTRAL DEPOSITORY SERVICES (INDIA) LIMITED" -> "Central Depository Services (India) Ltd"
     * e.g. "ITC LIMITED" -> "ITC Ltd"
     */
    private formatCompanyName(raw: string, symbol?: string): string {
        if (!raw) return symbol || '';

        let name = raw.replace(/\s+/g, ' ').trim();
        name = name.replace(/-\s+/g, '').replace(/\bLIM-ITED\b/gi, 'LIMITED');

        const knownAcronyms = new Set([
            'ITC', 'CDSL', 'NSDL', 'TCS', 'HDFC', 'ICICI', 'SBI', 'RBA', 'MRF', 'L&T', 'LT',
            'IRCTC', 'BHEL', 'BEL', 'ONGC', 'NTPC', 'IOCL', 'BPCL', 'HPCL', 'GAIL', 'NMDC',
            'SAIL', 'REC', 'PFC', 'NHPC', 'SJVN', 'HAL', 'RVNL', 'HUDCO', 'NBCC', 'IRFC'
        ]);

        const words = name.split(' ');
        const formattedWords = words.map(w => {
            const clean = w.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (knownAcronyms.has(clean)) {
                return w.replace(new RegExp(clean, 'i'), clean);
            }
            if (/^LIMITED$/i.test(w)) return 'Ltd';
            if (/^LIMITED\)?$/i.test(w)) return w.endsWith(')') ? 'Ltd)' : 'Ltd';
            if (/^PRIVATE$/i.test(w)) return 'Pvt';
            if (/^CORPORATION$/i.test(w)) return 'Corp';

            if (symbol && clean === symbol.replace(/\.(NS|BO)$/, '').toUpperCase()) {
                return clean;
            }

            if (w.startsWith('(') && w.endsWith(')')) {
                const inner = w.slice(1, -1);
                return '(' + inner.charAt(0).toUpperCase() + inner.slice(1).toLowerCase() + ')';
            }

            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        });

        return formattedWords.join(' ');
    }

    /** Group duplicate assets by symbol/name and calculate weighted average price */
    private groupDuplicates(assets: Omit<Asset, 'id'>[]): Omit<Asset, 'id'>[] {
        const map = new Map<string, Omit<Asset, 'id'>>();
        for (const a of assets) {
            const key = (a.symbol?.toLowerCase()) || a.name.toLowerCase();
            const existing = map.get(key);
            if (existing) {
                const oldQty = existing.quantity;
                const totalCost = existing.buyPrice * oldQty + a.buyPrice * a.quantity;
                existing.quantity = oldQty + a.quantity;
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

    /** Normalize a cell to a number — strips commas, currency symbols, whitespace */
    private num(val: any): number {
        if (val == null) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(String(val).replace(/[₹$,\s]|Rs\.?/gi, '')) || 0;
    }

    /** Read file as ArrayBuffer for xlsx / pdf */
    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }
}

export function isAssetMatch(imported: Omit<Asset, 'id'>, existing: Asset): boolean {
    // 1. Symbol match
    if (imported.symbol && existing.symbol) {
        const cleanImp = cleanSymbol(imported.symbol);
        const cleanExist = cleanSymbol(existing.symbol);
        if (cleanImp && cleanExist && cleanImp === cleanExist) {
            return true;
        }
    }

    // 2. Name match (normalized with Ltd / Limited substitution)
    const normImp = normalizeName(imported.name);
    const normExist = normalizeName(existing.name);
    if (normImp && normExist) {
        if (normImp === normExist) return true;
        const subImp = normImp.replace(/ltd$/, 'limited').replace(/limited$/, 'ltd');
        if (subImp === normExist) return true;
    }

    // 3. Substring match for mutual funds
    if (imported.type === AssetType.MutualFund && existing.type === AssetType.MutualFund) {
        const coreImp = cleanMfName(imported.name);
        const coreExist = cleanMfName(existing.name);
        if (coreImp.length > 5 && coreExist.length > 5 && (coreImp.includes(coreExist) || coreExist.includes(coreImp))) {
            return true;
        }
    }

    // 4. Cross match (imported symbol with existing name, or vice versa)
    if (imported.symbol && cleanSymbol(imported.symbol) === normalizeName(existing.name)) {
        return true;
    }
    if (existing.symbol && cleanSymbol(existing.symbol) === normalizeName(imported.name)) {
        return true;
    }

    return false;
}

function cleanSymbol(sym: string): string {
    return (sym || '')
        .toUpperCase()
        .replace(/^(NSE:|BSE:)/, '')
        .replace(/\.(NS|BO)$/, '')
        .replace(/[^A-Z0-9]/g, '')
        .trim();
}

function normalizeName(name: string): string {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function cleanMfName(name: string): string {
    return (name || '')
        .toLowerCase()
        .replace(/-( direct| regular| growth| idcw| dividend| plan| payout).*/i, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}
