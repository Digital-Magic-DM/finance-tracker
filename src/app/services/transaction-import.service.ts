import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { TransactionService } from './transaction.service';
import { Transaction, TransactionType } from '../models/finance.models';
import { firstValueFrom } from 'rxjs';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
// @ts-ignore - The dynamic import warning is suppressed for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface ParsedTransactionRow {
    selected: boolean;
    transaction: Omit<Transaction, 'id'>;
}

export interface TransactionImportResult {
    rows: ParsedTransactionRow[];
}

/**
 * Synonyms for header detection to handle various bank statement formats.
 */
const DATE_SYNONYMS = ['date', 'transaction date', 'txn date', 'value date', 'date of transaction', 'posting date'];
const DESC_SYNONYMS = ['description', 'narration', 'transaction details', 'remarks', 'particulars', 'payee', 'name'];
const AMOUNT_SYNONYMS = ['amount', 'transaction amount', 'value', 'txn amount', 'balance'];
const DEBIT_SYNONYMS = ['debit', 'withdrawal', 'out', 'payment', 'dr'];
const CREDIT_SYNONYMS = ['credit', 'deposit', 'in', 'receipt', 'cr'];
const CATEGORY_SYNONYMS = ['category', 'type', 'transaction type', 'tag'];
const STATUS_SYNONYMS = ['status', 'txn status', 'payment status'];

@Injectable({ providedIn: 'root' })
export class TransactionImportService {
    private transactionService = inject(TransactionService);

    async parseFile(file: File): Promise<TransactionImportResult> {
        const ext = file.name.split('.').pop()?.toLowerCase();
        
        if (ext === 'pdf') {
            return this.parsePdf(file);
        }

        const data = await this.readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        let bestRows: ParsedTransactionRow[] = [];
        let maxMatches = 0;

        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            
            const { headerIndex, headers, matchScore } = this.findHeaderRow(allRows);
            if (headerIndex >= 0 && matchScore > maxMatches) {
                const parsed = this.parseSheetRows(allRows, headerIndex, headers);
                if (parsed.length > 0) {
                    bestRows = parsed;
                    maxMatches = matchScore;
                }
            }
        }

        return this.applyDeduplication(bestRows);
    }

    private async parsePdf(file: File): Promise<TransactionImportResult> {
        const data = await this.readFileAsArrayBuffer(file);
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
        const pdf = await loadingTask.promise;
        
        const allRows: any[][] = [];
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const lines: Map<number, any[]> = new Map();
            
            for (const item of textContent.items as any[]) {
                const y = Math.round(item.transform[5]);
                if (!lines.has(y)) lines.set(y, []);
                lines.get(y)!.push(item);
            }

            const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);
            for (const y of sortedY) {
                const items = lines.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
                allRows.push(items.map(it => it.str));
            }
        }

        const { headerIndex, headers } = this.findHeaderRow(allRows);
        if (headerIndex < 0) return { rows: [] };

        const parsed = this.parseSheetRows(allRows, headerIndex, headers);
        return this.applyDeduplication(parsed);
    }

    private async applyDeduplication(parsedRows: ParsedTransactionRow[]): Promise<TransactionImportResult> {
        const existingTx = await firstValueFrom(this.transactionService.getTransactions()) as Transaction[];
        const existingHashes = new Set(existingTx.map(t => this.generateHash(t)));

        const results = parsedRows.map(row => ({
            ...row,
            selected: !existingHashes.has(this.generateHash(row.transaction))
        }));

        return { rows: results };
    }

    private parseSheetRows(allRows: any[][], headerIndex: number, headers: string[]): ParsedTransactionRow[] {
        const dataRows = allRows.slice(headerIndex + 1).filter(row => 
            row.some(cell => cell !== '' && cell != null)
        );

        const dateIdx = this.findCol(headers, DATE_SYNONYMS);
        const descIdx = this.findCol(headers, DESC_SYNONYMS);
        const amtIdx = this.findCol(headers, AMOUNT_SYNONYMS);
        const debitIdx = this.findCol(headers, DEBIT_SYNONYMS);
        const creditIdx = this.findCol(headers, CREDIT_SYNONYMS);
        const catIdx = this.findCol(headers, CATEGORY_SYNONYMS);
        const statusIdx = this.findCol(headers, STATUS_SYNONYMS);

        const transactions: ParsedTransactionRow[] = [];

        for (const row of dataRows) {
            // Check Status if available
            if (statusIdx >= 0) {
                const status = this.str(row[statusIdx]).toUpperCase();
                if (status && status !== 'SUCCESS') continue;
            }

            const desc = this.str(row[descIdx]);
            if (!desc) continue;

            let amount = 0;
            let type: TransactionType;

            if (debitIdx >= 0 || creditIdx >= 0) {
                const debit = this.num(row[debitIdx]);
                const credit = this.num(row[creditIdx]);
                
                if (credit > 0) {
                    amount = credit;
                    type = TransactionType.Income;
                } else if (debit > 0) {
                    amount = debit;
                    type = TransactionType.Expense;
                } else {
                    continue;
                }
            } else if (amtIdx >= 0) {
                const rawVal = row[amtIdx];
                const rawAmount = this.num(rawVal);
                amount = Math.abs(rawAmount);
                // positive amount -> Income, negative amount -> Expense
                type = rawAmount >= 0 ? TransactionType.Income : TransactionType.Expense;
                
                // Special check: if the raw string literally starts with '-', it's an expense regardless of Math.abs
                if (typeof rawVal === 'string' && rawVal.trim().startsWith('-')) {
                    type = TransactionType.Expense;
                }
            } else {
                continue;
            }

            const date = this.parseDate(row[dateIdx]);

            transactions.push({
                selected: true,
                transaction: {
                    description: desc,
                    amount: amount,
                    type: type,
                    category: catIdx >= 0 ? this.str(row[catIdx]) || 'Other' : 'Other',
                    date: date,
                    notes: 'Imported'
                }
            });
        }

        return transactions;
    }

    async importTransactions(rows: ParsedTransactionRow[]): Promise<{ created: number }> {
        const selected = rows.filter(r => r.selected).map(r => r.transaction);
        return this.transactionService.batchAddTransactions(selected);
    }

    private findHeaderRow(allRows: any[][]): { headerIndex: number; headers: string[]; matchScore: number } {
        for (let i = 0; i < Math.min(allRows.length, 50); i++) {
            const row = allRows[i];
            if (!row) continue;
            const lower = row.map(c => String(c).toLowerCase().trim());
            
            let matches = 0;
            if (this.hasMatch(lower, DATE_SYNONYMS)) matches++;
            if (this.hasMatch(lower, DESC_SYNONYMS)) matches++;
            if (this.hasMatch(lower, AMOUNT_SYNONYMS) || (this.hasMatch(lower, DEBIT_SYNONYMS) && this.hasMatch(lower, CREDIT_SYNONYMS))) matches++;
            if (this.hasMatch(lower, STATUS_SYNONYMS)) matches++;

            if (matches >= 2) return { headerIndex: i, headers: row.map(c => String(c)), matchScore: matches };
        }
        return { headerIndex: -1, headers: [], matchScore: 0 };
    }

    private hasMatch(headers: string[], synonyms: string[]): boolean {
        return headers.some(h => synonyms.some(s => h === s || h.includes(s)));
    }

    private findCol(headers: string[], synonyms: string[]): number {
        const lower = headers.map(h => String(h).toLowerCase().trim());
        for (const syn of synonyms) {
            const idx = lower.findIndex(h => h === syn || h.includes(syn));
            if (idx >= 0) return idx;
        }
        return -1;
    }

    private parseDate(val: any): Date {
        if (!val) return new Date();
        if (val instanceof Date) return val;
        
        if (typeof val === 'number') {
            return new Date(Math.round((val - 25569) * 86400 * 1000));
        }

        const strVal = String(val).trim();
        // Handle formats like "1 February 2026"
        const d = new Date(strVal);
        if (!isNaN(d.getTime())) return d;

        // Fallback for custom formats if necessary, but standard Date often handles "1 February 2026"
        return new Date();
    }

    private str(val: any): string { return val == null ? '' : String(val).trim(); }

    private num(val: any): number {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleaned = String(val).replace(/[₹$,\s]|Rs\.?/gi, '');
        return parseFloat(cleaned) || 0;
    }

    private generateHash(tx: Omit<Transaction, 'id'> | Transaction): string {
        const dateRaw = tx.date;
        let d: Date;
        if (dateRaw instanceof Date) {
            d = dateRaw;
        } else if (dateRaw && typeof (dateRaw as any).seconds === 'number') {
            d = new Date((dateRaw as any).seconds * 1000);
        } else {
            d = new Date(dateRaw as any);
        }
        
        const dateStr = isNaN(d.getTime()) ? 'invalid' : d.toISOString().split('T')[0];
        const desc = tx.description.toLowerCase().trim();
        const amt = Number(tx.amount).toFixed(2);
        return `${dateStr}|${desc}|${amt}`;
    }

    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }
}
