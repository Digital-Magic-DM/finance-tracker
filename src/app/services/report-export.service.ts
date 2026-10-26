import { Injectable, inject } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as ExcelJS from 'exceljs';
import { SnackbarService } from './snackbar.service';

export interface ReportMetadata {
    title: string;
    subtitle?: string;
    userName?: string;
    userEmail?: string;
    periodLabel: string;
    fromDate?: string;
    toDate?: string;
}

export interface SummaryMetric {
    label: string;
    value: string;
    subtext?: string;
    isPositive?: boolean;
    isNegative?: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class ReportExportService {
    private snackbar = inject(SnackbarService);
    private logoBase64Cache: string | null = null;

    /**
     * Cache and retrieve the app logo as base64 for embedding in PDF and Excel
     */
    async getLogoBase64(): Promise<string | null> {
        if (this.logoBase64Cache) return this.logoBase64Cache;
        try {
            const res = await fetch('/assets/applogo.png');
            if (!res.ok) return null;
            const blob = await res.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    this.logoBase64Cache = reader.result as string;
                    resolve(this.logoBase64Cache);
                };
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('[ReportExport] Could not load logo image:', e);
            return null;
        }
    }

    /**
     * Download blob as file
     */
    downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    formatCurrency(num: number | null | undefined, prefix: string = 'Rs. '): string {
        if (num == null || isNaN(num)) return `${prefix}0.00`;
        const formatted = Math.abs(Number(num)).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return num < 0 ? `-${prefix}${formatted}` : `${prefix}${formatted}`;
    }

    formatPct(num: number | null | undefined): string {
        if (num == null || isNaN(num)) return '0.00%';
        const s = Number(num).toFixed(2);
        return num > 0 ? `+${s}%` : `${s}%`;
    }

    formatDate(d: any): string {
        if (!d) return '-';
        const dateObj = d instanceof Date ? d : new Date(d);
        if (isNaN(dateObj.getTime())) return String(d);
        return dateObj.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    // =========================================================================
    // CORE BEAUTIFUL PDF BUILDER
    // =========================================================================
    async generatePdf(
        meta: ReportMetadata,
        metrics: SummaryMetric[],
        tables: Array<{
            sectionTitle?: string;
            columns: string[];
            rows: (string | number)[][];
            columnStyles?: { [key: number]: any };
        }>,
        filename: string
    ) {
        try {
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const logoBase64 = await this.getLogoBase64();
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            let currentY = 15;

            // Header Banner (Slate 900)
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, pageWidth, 28, 'F');

            // FinTracker Logo
            if (logoBase64) {
                try {
                    doc.addImage(logoBase64, 'PNG', 14, 4.5, 19, 19);
                } catch {
                    doc.setFillColor(59, 130, 246);
                    doc.roundedRect(14, 5.5, 17, 17, 3, 3, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(10);
                    doc.setFont('helvetica', 'bold');
                    doc.text('FT', 19, 16.5);
                }
            }

            // Brand Title & Tagline
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('FINTRACKER', 38, 12);

            doc.setTextColor(148, 163, 184); // Slate 400
            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'normal');
            doc.text('Personal Wealth Intelligence & Financial Analytics', 38, 17.5);

            // Right Header: Date & Period
            doc.setFontSize(8);
            doc.setTextColor(203, 213, 225);
            const dateStr = new Date().toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
            doc.text(`Generated: ${dateStr}`, pageWidth - 14, 11, { align: 'right' });
            doc.setTextColor(148, 163, 184);
            doc.text(`Period: ${meta.periodLabel}`, pageWidth - 14, 17, { align: 'right' });

            currentY = 36;

            // Statement Title Bar
            doc.setTextColor(15, 23, 42);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(meta.title, 14, currentY);

            // User Info line
            currentY += 5.5;
            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            const userStr = `Statement for: ${meta.userName || 'Account Holder'}${meta.userEmail ? ` (${meta.userEmail})` : ''}   •   Official Statement`;
            doc.text(userStr, 14, currentY);

            // Divider line
            currentY += 4;
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.4);
            doc.line(14, currentY, pageWidth - 14, currentY);

            // Summary Metrics Cards (if provided)
            if (metrics && metrics.length > 0) {
                currentY += 5;
                const cardGap = 3.5;
                const usableWidth = pageWidth - 28;
                const maxCardsPerRow = Math.min(metrics.length, 4);
                const cardWidth = (usableWidth - (maxCardsPerRow - 1) * cardGap) / maxCardsPerRow;
                const cardHeight = 16;

                for (let i = 0; i < maxCardsPerRow; i++) {
                    const m = metrics[i];
                    const cardX = 14 + i * (cardWidth + cardGap);

                    // Card background
                    doc.setFillColor(248, 250, 252);
                    doc.setDrawColor(226, 232, 240);
                    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 2, 2, 'FD');

                    // Label
                    doc.setFontSize(7.5);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(100, 116, 139);
                    doc.text(m.label.toUpperCase(), cardX + 3.5, currentY + 4.8);

                    // Value
                    doc.setFontSize(10.5);
                    doc.setFont('helvetica', 'bold');
                    if (m.isPositive) {
                        doc.setTextColor(16, 185, 129); // Emerald
                    } else if (m.isNegative) {
                        doc.setTextColor(239, 68, 68); // Red
                    } else {
                        doc.setTextColor(15, 23, 42); // Slate
                    }
                    doc.text(m.value, cardX + 3.5, currentY + 10.5);

                    // Subtext
                    if (m.subtext) {
                        doc.setFontSize(6.5);
                        doc.setFont('helvetica', 'normal');
                        doc.setTextColor(148, 163, 184);
                        doc.text(m.subtext, cardX + 3.5, currentY + 14);
                    }
                }
                currentY += cardHeight + 6;
            } else {
                currentY += 4;
            }

            // Render Tables
            for (const tbl of tables) {
                if (tbl.sectionTitle) {
                    if (currentY > pageHeight - 35) {
                        doc.addPage();
                        currentY = 18;
                    }
                    doc.setFontSize(10.5);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(30, 41, 59);
                    doc.text(tbl.sectionTitle, 14, currentY);
                    currentY += 3;
                }

                autoTable(doc, {
                    startY: currentY,
                    head: [tbl.columns],
                    body: tbl.rows,
                    theme: 'striped',
                    styles: {
                        fontSize: 8,
                        cellPadding: 2.2,
                        textColor: [30, 41, 59],
                        lineColor: [226, 232, 240],
                        lineWidth: 0.1,
                    },
                    headStyles: {
                        fillColor: [15, 23, 42],
                        textColor: [255, 255, 255],
                        fontStyle: 'bold',
                        fontSize: 8,
                    },
                    alternateRowStyles: {
                        fillColor: [248, 250, 252]
                    },
                    columnStyles: tbl.columnStyles || {},
                    margin: { left: 14, right: 14, bottom: 18 },
                    didDrawPage: (data) => {
                        const pageCount = (doc.internal as any).getNumberOfPages();
                        const pageCurrent = data.pageNumber;
                        doc.setFontSize(7.5);
                        doc.setFont('helvetica', 'normal');
                        doc.setTextColor(148, 163, 184);
                        doc.text(
                            `FinTracker Confidential Statement   •   Page ${pageCurrent} of ${pageCount}`,
                            pageWidth / 2,
                            pageHeight - 8,
                            { align: 'center' }
                        );
                    }
                });

                currentY = (doc as any).lastAutoTable.finalY + 8;
            }

            doc.save(filename);
            this.snackbar.show(`Exported PDF: ${filename}`, 'success');
        } catch (err: any) {
            console.error('PDF export failed:', err);
            this.snackbar.show(`PDF export failed: ${err.message}`, 'error');
        }
    }

    // =========================================================================
    // CORE BEAUTIFUL EXCEL BUILDER
    // =========================================================================
    async generateExcel(
        meta: ReportMetadata,
        metrics: SummaryMetric[],
        sheets: Array<{
            sheetName: string;
            columns: { header: string; key: string; width: number }[];
            rows: any[];
        }>,
        filename: string
    ) {
        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'FinTracker Personal Finance';
            workbook.lastModifiedBy = meta.userName || 'FinTracker';
            workbook.created = new Date();

            const logoBase64 = await this.getLogoBase64();
            let logoImageId: number | null = null;
            if (logoBase64) {
                try {
                    const rawBase64 = logoBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                    logoImageId = workbook.addImage({
                        base64: rawBase64,
                        extension: 'png'
                    });
                } catch (e) {
                    console.warn('[ReportExport] Could not attach image to Excel:', e);
                }
            }

            sheets.forEach((sh, idx) => {
                const ws = workbook.addWorksheet(sh.sheetName, {
                    views: [{ showGridLines: true }]
                });

                let r = 1;

                // Add Logo to top left of first sheet
                if (logoImageId !== null && idx === 0) {
                    ws.addImage(logoImageId, {
                        tl: { col: 0.1, row: 0.2 },
                        ext: { width: 44, height: 44 }
                    });
                }

                const startCol = logoImageId !== null && idx === 0 ? 2 : 1;
                const endCol = Math.max(sh.columns.length, 6);

                // Title row
                ws.mergeCells(r, startCol, r, endCol);
                const titleCell = ws.getCell(r, startCol);
                titleCell.value = `FINTRACKER   |   ${meta.title.toUpperCase()}`;
                titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F172A' } };
                r++;

                // Subtitle metadata row
                ws.mergeCells(r, startCol, r, endCol);
                const metaCell = ws.getCell(r, startCol);
                metaCell.value = `Reporting Period: ${meta.periodLabel}   |   Account Holder: ${meta.userName || 'User'}   |   Export Date: ${new Date().toLocaleString('en-IN')}`;
                metaCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
                r += 2;

                // Summary Metrics Box on first sheet
                if (idx === 0 && metrics && metrics.length > 0) {
                    const metricHeaderRow = ws.getRow(r);
                    const metricValRow = ws.getRow(r + 1);

                    metrics.slice(0, 6).forEach((m, mIdx) => {
                        const colIdx = mIdx + 1;
                        const hCell = metricHeaderRow.getCell(colIdx);
                        hCell.value = m.label.toUpperCase();
                        hCell.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF64748B' } };
                        hCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF1F5F9' }
                        };

                        const vCell = metricValRow.getCell(colIdx);
                        vCell.value = m.value;
                        vCell.font = {
                            name: 'Calibri',
                            size: 11,
                            bold: true,
                            color: { argb: m.isPositive ? 'FF10B981' : m.isNegative ? 'FFEF4444' : 'FF0F172A' }
                        };
                        vCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF8FAFC' }
                        };
                    });
                    r += 3;
                }

                // Table Headers
                const headerRow = ws.getRow(r);
                sh.columns.forEach((col, cIdx) => {
                    const c = headerRow.getCell(cIdx + 1);
                    c.value = col.header;
                    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                    c.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF0F172A' }
                    };
                    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                });
                headerRow.height = 24;
                r++;

                // Data Rows
                sh.rows.forEach((rowData, rowIdx) => {
                    const row = ws.getRow(r);
                    sh.columns.forEach((col, cIdx) => {
                        const cell = row.getCell(cIdx + 1);
                        const val = rowData[col.key];
                        cell.value = val;
                        cell.font = { name: 'Calibri', size: 9.5 };

                        if (rowIdx % 2 === 1) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFF8FAFC' }
                            };
                        }

                        if (typeof val === 'number') {
                            cell.alignment = { horizontal: 'right' };
                            if (col.key.toLowerCase().includes('price') || 
                                col.key.toLowerCase().includes('value') || 
                                col.key.toLowerCase().includes('amount') || 
                                col.key.toLowerCase().includes('profit') || 
                                col.key.toLowerCase().includes('invested') || 
                                col.key.toLowerCase().includes('principal')) {
                                cell.numFmt = '₹#,##0.00';
                            }
                        }
                    });
                    row.height = 19;
                    r++;
                });

                // Set column widths
                sh.columns.forEach((col, cIdx) => {
                    ws.getColumn(cIdx + 1).width = Math.max(col.width, 14);
                });
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            this.downloadBlob(blob, filename);
            this.snackbar.show(`Exported Excel: ${filename}`, 'success');
        } catch (err: any) {
            console.error('Excel export failed:', err);
            this.snackbar.show(`Excel export failed: ${err.message}`, 'error');
        }
    }

    // =========================================================================
    // HIGH-LEVEL SPECIALIZED EXPORTERS
    // =========================================================================

    /**
     * 1. MASTER FINANCIAL STATEMENT (Multi-Section / Multi-Sheet)
     */
    async exportMasterReport(format: 'pdf' | 'excel', data: {
        portfolio: any;
        txSummary: any;
        txs: any[];
        user: any;
        periodLabel: string;
        fromDate?: string;
        toDate?: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Master Comprehensive Financial Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel,
            fromDate: data.fromDate,
            toDate: data.toDate
        };

        const metrics: SummaryMetric[] = [
            { label: 'Total Net Worth', value: this.formatCurrency(data.portfolio.totalValue), isPositive: true },
            { label: 'Invested Capital', value: this.formatCurrency(data.portfolio.totalInvested) },
            { 
                label: 'Overall Returns', 
                value: this.formatCurrency(data.portfolio.totalProfit), 
                subtext: this.formatPct(data.portfolio.totalProfitPct),
                isPositive: data.portfolio.totalProfit >= 0,
                isNegative: data.portfolio.totalProfit < 0
            },
            { 
                label: 'Period Net Savings', 
                value: this.formatCurrency(data.txSummary.netSavings),
                subtext: `Inflow: ${this.formatCurrency(data.txSummary.totalIncome)}`,
                isPositive: data.txSummary.netSavings >= 0,
                isNegative: data.txSummary.netSavings < 0
            }
        ];

        const fStr = data.fromDate || 'all';
        const tStr = data.toDate || 'present';

        if (format === 'pdf') {
            const allocationRows = data.portfolio.breakdownList.map((b: any) => [
                b.type,
                b.count,
                this.formatCurrency(b.invested),
                this.formatCurrency(b.value),
                this.formatCurrency(b.profit),
                b.allocationPct.toFixed(1) + '%'
            ]);

            const txRows = data.txs.slice(0, 100).map((t: any) => [
                this.formatDate(t.date),
                t.type,
                t.description || '-',
                t.category || '-',
                t.bank || '-',
                this.formatCurrency(t.amount)
            ]);

            await this.generatePdf(
                meta,
                metrics,
                [
                    {
                        sectionTitle: '1. Asset Allocation & Portfolio Breakdown',
                        columns: ['Asset Category', 'Holdings', 'Invested', 'Current Value', 'Gain / Loss', 'Allocation'],
                        rows: allocationRows,
                        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
                    },
                    {
                        sectionTitle: `2. Transactions Journal (${data.periodLabel})`,
                        columns: ['Date', 'Type', 'Description', 'Category', 'Account', 'Amount'],
                        rows: txRows,
                        columnStyles: { 5: { halign: 'right' } }
                    }
                ],
                `FinTracker_Master_Statement_${fStr}_to_${tStr}.pdf`
            );
        } else {
            // Excel Multi-Sheet
            const allocColumns = [
                { header: 'Asset Category', key: 'type', width: 22 },
                { header: 'Holdings Count', key: 'count', width: 16 },
                { header: 'Invested Value', key: 'invested', width: 20 },
                { header: 'Current Value', key: 'value', width: 20 },
                { header: 'Profit / Loss', key: 'profit', width: 20 },
                { header: 'Allocation %', key: 'allocation', width: 16 },
            ];
            const allocRows = data.portfolio.breakdownList.map((b: any) => ({
                type: b.type,
                count: b.count,
                invested: b.invested,
                value: b.value,
                profit: b.profit,
                allocation: b.allocationPct.toFixed(1) + '%'
            }));

            const txColumns = [
                { header: 'Date', key: 'date', width: 14 },
                { header: 'Type', key: 'type', width: 14 },
                { header: 'Description', key: 'description', width: 32 },
                { header: 'Category', key: 'category', width: 20 },
                { header: 'Bank / Account', key: 'bank', width: 20 },
                { header: 'Amount', key: 'amount', width: 18 }
            ];
            const txRows = data.txs.map((t: any) => ({
                date: this.formatDate(t.date),
                type: t.type,
                description: t.description || '',
                category: t.category || '',
                bank: t.bank || '',
                amount: t.amount || 0
            }));

            await this.generateExcel(
                meta,
                metrics,
                [
                    { sheetName: 'Asset Allocation', columns: allocColumns, rows: allocRows },
                    { sheetName: 'Transactions Ledger', columns: txColumns, rows: txRows }
                ],
                `FinTracker_Master_Statement_${fStr}_to_${tStr}.xlsx`
            );
        }
    }

    /**
     * 2. TRANSACTIONS & CASH FLOW STATEMENT
     */
    async exportTransactionsReport(format: 'pdf' | 'excel', data: {
        txSummary: any;
        txs: any[];
        user: any;
        periodLabel: string;
        fromDate?: string;
        toDate?: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Transactions & Cash Flow Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel,
            fromDate: data.fromDate,
            toDate: data.toDate
        };

        const metrics: SummaryMetric[] = [
            { label: 'Total Inflow (Income)', value: this.formatCurrency(data.txSummary.totalIncome), isPositive: true },
            { label: 'Total Outflow (Expenses)', value: this.formatCurrency(data.txSummary.totalExpense), isNegative: true },
            { 
                label: 'Net Period Savings', 
                value: this.formatCurrency(data.txSummary.netSavings),
                isPositive: data.txSummary.netSavings >= 0,
                isNegative: data.txSummary.netSavings < 0
            },
            { label: 'Total Records', value: String(data.txSummary.count) }
        ];

        const fStr = data.fromDate || 'all';
        const tStr = data.toDate || 'present';

        if (format === 'pdf') {
            const rows = data.txs.map((t: any) => [
                this.formatDate(t.date),
                t.type,
                t.description || '-',
                t.category || '-',
                t.bank || '-',
                this.formatCurrency(t.amount)
            ]);

            await this.generatePdf(
                meta,
                metrics,
                [{
                    sectionTitle: `Detailed Transaction Records (${data.periodLabel})`,
                    columns: ['Date', 'Type', 'Description', 'Category', 'Bank / Wallet', 'Amount'],
                    rows,
                    columnStyles: { 5: { halign: 'right' } }
                }],
                `FinTracker_Transactions_${fStr}_to_${tStr}.pdf`
            );
        } else {
            const columns = [
                { header: 'Date', key: 'date', width: 14 },
                { header: 'Type', key: 'type', width: 14 },
                { header: 'Description', key: 'description', width: 32 },
                { header: 'Category', key: 'category', width: 20 },
                { header: 'Bank / Account', key: 'bank', width: 20 },
                { header: 'Amount', key: 'amount', width: 18 }
            ];
            const rows = data.txs.map((t: any) => ({
                date: this.formatDate(t.date),
                type: t.type,
                description: t.description || '',
                category: t.category || '',
                bank: t.bank || '',
                amount: t.amount || 0
            }));

            await this.generateExcel(
                meta,
                metrics,
                [{ sheetName: 'Transactions', columns, rows }],
                `FinTracker_Transactions_${fStr}_to_${tStr}.xlsx`
            );
        }
    }

    /**
     * 3. OVERALL PORTFOLIO STATEMENT
     */
    async exportPortfolioReport(format: 'pdf' | 'excel', data: {
        portfolio: any;
        assets: any[];
        user: any;
        periodLabel: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Consolidated Portfolio Holdings Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel
        };

        const metrics: SummaryMetric[] = [
            { label: 'Current Portfolio Value', value: this.formatCurrency(data.portfolio.totalValue), isPositive: true },
            { label: 'Total Invested Capital', value: this.formatCurrency(data.portfolio.totalInvested) },
            { 
                label: 'Absolute Gain / Loss', 
                value: this.formatCurrency(data.portfolio.totalProfit),
                isPositive: data.portfolio.totalProfit >= 0,
                isNegative: data.portfolio.totalProfit < 0
            },
            { 
                label: 'Overall Returns %', 
                value: this.formatPct(data.portfolio.totalProfitPct),
                isPositive: data.portfolio.totalProfitPct >= 0,
                isNegative: data.portfolio.totalProfitPct < 0
            }
        ];

        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const allocRows = data.portfolio.breakdownList.map((b: any) => [
                b.type,
                b.count,
                this.formatCurrency(b.invested),
                this.formatCurrency(b.value),
                this.formatCurrency(b.profit),
                b.allocationPct.toFixed(1) + '%'
            ]);

            const holdingRows = data.assets.map((a: any) => {
                const qty = a.quantity || 1;
                const bp = a.buyPrice || 0;
                const cp = a.currentPrice != null ? a.currentPrice : bp;
                const inv = qty * bp;
                const val = qty * cp;
                const pl = val - inv;
                return [
                    a.name || '-',
                    a.symbol || '-',
                    a.type || '-',
                    qty,
                    this.formatCurrency(bp),
                    this.formatCurrency(cp),
                    this.formatCurrency(val),
                    this.formatCurrency(pl)
                ];
            });

            await this.generatePdf(
                meta,
                metrics,
                [
                    {
                        sectionTitle: 'Asset Category Allocation',
                        columns: ['Category', 'Count', 'Invested', 'Current Value', 'Gain / Loss', 'Allocation'],
                        rows: allocRows,
                        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
                    },
                    {
                        sectionTitle: 'All Holdings Inventory',
                        columns: ['Asset Name', 'Symbol', 'Type', 'Qty', 'Buy Price', 'Cur Price', 'Total Value', 'Gain / Loss'],
                        rows: holdingRows,
                        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } }
                    }
                ],
                `FinTracker_Portfolio_${dateStr}.pdf`
            );
        } else {
            const allocCols = [
                { header: 'Category', key: 'type', width: 20 },
                { header: 'Holdings Count', key: 'count', width: 16 },
                { header: 'Invested', key: 'invested', width: 18 },
                { header: 'Current Value', key: 'value', width: 18 },
                { header: 'Gain / Loss', key: 'profit', width: 18 },
                { header: 'Allocation %', key: 'allocation', width: 16 }
            ];
            const allocRows = data.portfolio.breakdownList.map((b: any) => ({
                type: b.type,
                count: b.count,
                invested: b.invested,
                value: b.value,
                profit: b.profit,
                allocation: b.allocationPct.toFixed(1) + '%'
            }));

            const holdingCols = [
                { header: 'Asset Name', key: 'name', width: 28 },
                { header: 'Symbol', key: 'symbol', width: 14 },
                { header: 'Asset Type', key: 'type', width: 18 },
                { header: 'Quantity', key: 'quantity', width: 14 },
                { header: 'Buy Price', key: 'buyPrice', width: 16 },
                { header: 'Current Price', key: 'currentPrice', width: 16 },
                { header: 'Invested Value', key: 'invested', width: 18 },
                { header: 'Current Value', key: 'value', width: 18 },
                { header: 'Unrealized P&L', key: 'profit', width: 18 },
                { header: 'Broker / App Source', key: 'source', width: 20 }
            ];
            const holdingRows = data.assets.map((a: any) => {
                const qty = a.quantity || 1;
                const bp = a.buyPrice || 0;
                const cp = a.currentPrice != null ? a.currentPrice : bp;
                return {
                    name: a.name || '',
                    symbol: a.symbol || '',
                    type: a.type || '',
                    quantity: qty,
                    buyPrice: bp,
                    currentPrice: cp,
                    invested: qty * bp,
                    value: qty * cp,
                    profit: (qty * cp) - (qty * bp),
                    source: a.appSource || a.metadata?.source || '-'
                };
            });

            await this.generateExcel(
                meta,
                metrics,
                [
                    { sheetName: 'Asset Allocation', columns: allocCols, rows: allocRows },
                    { sheetName: 'Holdings List', columns: holdingCols, rows: holdingRows }
                ],
                `FinTracker_Portfolio_${dateStr}.xlsx`
            );
        }
    }

    /**
     * 4. STOCKS PORTFOLIO STATEMENT
     */
    async exportStocksReport(format: 'pdf' | 'excel', data: {
        stocks: any;
        user: any;
        periodLabel: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Equity & Stocks Portfolio Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel
        };

        const metrics: SummaryMetric[] = [
            { label: 'Total Stock Value', value: this.formatCurrency(data.stocks.totalValue), isPositive: true },
            { label: 'Invested Capital', value: this.formatCurrency(data.stocks.totalInvested) },
            { 
                label: 'Unrealized Gain / Loss', 
                value: this.formatCurrency(data.stocks.totalProfit),
                isPositive: data.stocks.totalProfit >= 0,
                isNegative: data.stocks.totalProfit < 0
            },
            { 
                label: 'Stock Returns %', 
                value: this.formatPct(data.stocks.totalProfitPct),
                isPositive: data.stocks.totalProfitPct >= 0,
                isNegative: data.stocks.totalProfitPct < 0
            }
        ];

        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const rows = data.stocks.rows.map((s: any) => [
                s.symbol || '-',
                s.name || '-',
                s.exchange || '-',
                s.quantity || 0,
                this.formatCurrency(s.buyPrice),
                this.formatCurrency(s.currentPrice || s.buyPrice),
                this.formatCurrency(s.invested),
                this.formatCurrency(s.value),
                this.formatCurrency(s.profit),
                this.formatPct(s.profitPct)
            ]);

            await this.generatePdf(
                meta,
                metrics,
                [{
                    sectionTitle: 'Equity Holdings & Valuation',
                    columns: ['Symbol', 'Company', 'Exch', 'Qty', 'Buy Price', 'Cur Price', 'Invested', 'Current Val', 'P&L', 'Return %'],
                    rows,
                    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } }
                }],
                `FinTracker_Stocks_${dateStr}.pdf`
            );
        } else {
            const columns = [
                { header: 'Symbol', key: 'symbol', width: 14 },
                { header: 'Company Name', key: 'name', width: 28 },
                { header: 'Exchange', key: 'exchange', width: 14 },
                { header: 'Quantity', key: 'quantity', width: 12 },
                { header: 'Average Buy Price', key: 'buyPrice', width: 18 },
                { header: 'Current Market Price', key: 'curPrice', width: 18 },
                { header: 'Invested Value', key: 'invested', width: 18 },
                { header: 'Current Valuation', key: 'value', width: 18 },
                { header: 'Profit / Loss', key: 'profit', width: 18 },
                { header: 'Returns %', key: 'profitPct', width: 14 }
            ];
            const rows = data.stocks.rows.map((s: any) => ({
                symbol: s.symbol || '',
                name: s.name || '',
                exchange: s.exchange || '',
                quantity: s.quantity || 0,
                buyPrice: s.buyPrice || 0,
                curPrice: s.currentPrice || s.buyPrice || 0,
                invested: s.invested || 0,
                value: s.value || 0,
                profit: s.profit || 0,
                profitPct: this.formatPct(s.profitPct)
            }));

            await this.generateExcel(
                meta,
                metrics,
                [{ sheetName: 'Stocks Portfolio', columns, rows }],
                `FinTracker_Stocks_${dateStr}.xlsx`
            );
        }
    }

    /**
     * 5. MUTUAL FUNDS STATEMENT
     */
    async exportMutualFundsReport(format: 'pdf' | 'excel', data: {
        mf: any;
        user: any;
        periodLabel: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Mutual Funds Investment Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel
        };

        const metrics: SummaryMetric[] = [
            { label: 'Total MF Value', value: this.formatCurrency(data.mf.totalValue), isPositive: true },
            { label: 'Invested Capital', value: this.formatCurrency(data.mf.totalInvested) },
            { 
                label: 'Unrealized Gain / Loss', 
                value: this.formatCurrency(data.mf.totalProfit),
                isPositive: data.mf.totalProfit >= 0,
                isNegative: data.mf.totalProfit < 0
            },
            { 
                label: 'MF Returns %', 
                value: this.formatPct(data.mf.totalProfitPct),
                isPositive: data.mf.totalProfitPct >= 0,
                isNegative: data.mf.totalProfitPct < 0
            }
        ];

        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const rows = data.mf.rows.map((m: any) => [
                m.name || '-',
                m.subType || m.category || 'Direct Growth',
                (m.units || 0).toFixed(3),
                this.formatCurrency(m.buyNav),
                this.formatCurrency(m.curNav),
                this.formatCurrency(m.invested),
                this.formatCurrency(m.value),
                this.formatCurrency(m.profit),
                this.formatPct(m.profitPct)
            ]);

            await this.generatePdf(
                meta,
                metrics,
                [{
                    sectionTitle: 'Mutual Funds Portfolio & NAV Valuation',
                    columns: ['Scheme Name', 'Category', 'Units', 'Buy NAV', 'Cur NAV', 'Invested', 'Current Val', 'Gain / Loss', 'Return %'],
                    rows,
                    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }
                }],
                `FinTracker_Mutual_Funds_${dateStr}.pdf`
            );
        } else {
            const columns = [
                { header: 'Scheme / Fund Name', key: 'name', width: 32 },
                { header: 'Category / Plan', key: 'category', width: 20 },
                { header: 'Units Held', key: 'units', width: 14 },
                { header: 'Purchase NAV', key: 'buyNav', width: 16 },
                { header: 'Current NAV', key: 'curNav', width: 16 },
                { header: 'Invested Value', key: 'invested', width: 18 },
                { header: 'Current Valuation', key: 'value', width: 18 },
                { header: 'Profit / Loss', key: 'profit', width: 18 },
                { header: 'Returns %', key: 'profitPct', width: 14 }
            ];
            const rows = data.mf.rows.map((m: any) => ({
                name: m.name || '',
                category: m.subType || m.category || 'Direct Growth',
                units: m.units || 0,
                buyNav: m.buyNav || 0,
                curNav: m.curNav || 0,
                invested: m.invested || 0,
                value: m.value || 0,
                profit: m.profit || 0,
                profitPct: this.formatPct(m.profitPct)
            }));

            await this.generateExcel(
                meta,
                metrics,
                [{ sheetName: 'Mutual Funds', columns, rows }],
                `FinTracker_Mutual_Funds_${dateStr}.xlsx`
            );
        }
    }

    /**
     * 6. FIXED INCOME & BONDS STATEMENT
     */
    async exportFixedIncomeReport(format: 'pdf' | 'excel', data: {
        fi: any;
        user: any;
        periodLabel: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Fixed Deposits & Sovereign Bonds Statement',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel
        };

        const metrics: SummaryMetric[] = [
            { label: 'Total Portfolio Value', value: this.formatCurrency(data.fi.totalValue), isPositive: true },
            { label: 'Principal Deposited', value: this.formatCurrency(data.fi.totalPrincipal) },
            { label: 'Accrued Gains', value: this.formatCurrency(data.fi.accruedGain), isPositive: true },
            { label: 'Weighted Avg Yield', value: data.fi.avgRate > 0 ? `${data.fi.avgRate.toFixed(2)}% p.a.` : 'N/A' }
        ];

        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const rows = data.fi.rows.map((f: any) => [
                f.name || '-',
                f.subType || 'FD',
                f.bank || f.issuer || '-',
                this.formatCurrency(f.principal),
                f.interestRate > 0 ? `${f.interestRate}%` : '-',
                this.formatDate(f.maturityDate),
                this.formatCurrency(f.curVal)
            ]);

            await this.generatePdf(
                meta,
                metrics,
                [{
                    sectionTitle: 'Fixed Income Instruments & Maturity Registry',
                    columns: ['Instrument Name', 'Type', 'Bank / Issuer', 'Principal', 'Interest Rate', 'Maturity Date', 'Current / Maturity Val'],
                    rows,
                    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' } }
                }],
                `FinTracker_Fixed_Income_${dateStr}.pdf`
            );
        } else {
            const columns = [
                { header: 'Instrument Name', key: 'name', width: 28 },
                { header: 'Instrument Type', key: 'type', width: 16 },
                { header: 'Bank / Issuer', key: 'bank', width: 22 },
                { header: 'Principal Amount', key: 'principal', width: 18 },
                { header: 'Interest Rate %', key: 'interestRate', width: 16 },
                { header: 'Maturity Date', key: 'maturityDate', width: 18 },
                { header: 'Current / Maturity Value', key: 'curVal', width: 22 }
            ];
            const rows = data.fi.rows.map((f: any) => ({
                name: f.name || '',
                type: f.subType || 'FD',
                bank: f.bank || f.issuer || '',
                principal: f.principal || 0,
                interestRate: f.interestRate > 0 ? `${f.interestRate}%` : 'N/A',
                maturityDate: this.formatDate(f.maturityDate),
                curVal: f.curVal || 0
            }));

            await this.generateExcel(
                meta,
                metrics,
                [{ sheetName: 'Fixed Deposits & Bonds', columns, rows }],
                `FinTracker_Fixed_Income_${dateStr}.xlsx`
            );
        }
    }

    /**
     * 7. SIPs & AUTO-INVEST MANDATES STATEMENT
     */
    async exportSipsReport(format: 'pdf' | 'excel', data: {
        sips: any[];
        metrics: {
            totalMonthlyCommitment: number;
            totalActiveSips: number;
            totalExecutedInstallments?: number;
            totalInvested?: number;
        };
        user?: any;
        periodLabel?: string;
    }) {
        const meta: ReportMetadata = {
            title: 'Systematic Investment Plans (SIP) Statement',
            subtitle: 'Real-World Market Trading Day Execution & Mandate Ledger',
            userName: data.user?.displayName,
            userEmail: data.user?.email,
            periodLabel: data.periodLabel || 'All Active Mandates'
        };

        const metrics: SummaryMetric[] = [
            { label: 'Monthly SIP Outflow', value: this.formatCurrency(data.metrics.totalMonthlyCommitment), isPositive: true },
            { label: 'Active SIP Plans', value: String(data.metrics.totalActiveSips) },
            { label: 'Cumulative SIP Outflow', value: this.formatCurrency(data.metrics.totalInvested || 0) },
            { label: 'Installments Executed', value: String(data.metrics.totalExecutedInstallments || 0) }
        ];

        const dateStr = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const planRows = data.sips.map((s: any) => [
                s.name || '-',
                s.category || 'MutualFund',
                s.frequency || 'Monthly',
                s.sipDay ? `Day ${s.sipDay}` : '-',
                this.formatCurrency(s.amount),
                s.nextExecutionDate ? this.formatDate(s.nextExecutionDate) : '-',
                s.stepUp?.enabled ? `+${s.stepUp.value}%/yr` : 'None',
                s.status || 'Active'
            ]);

            // Collect all installments across SIPs
            const ledgerRows: any[] = [];
            data.sips.forEach((s: any) => {
                const list = s.installments || s.installmentHistory;
                if (list && Array.isArray(list)) {
                    list.forEach((inst: any) => {
                        ledgerRows.push([
                            this.formatDate(inst.executionDate || inst.scheduledDate),
                            s.name,
                            inst.scheduledDate || '-',
                            inst.status || 'Success',
                            this.formatCurrency(inst.amount),
                            inst.unitsAllotted ? Number(inst.unitsAllotted).toFixed(3) : '-',
                            inst.navOrPrice ? this.formatCurrency(inst.navOrPrice) : '-'
                        ]);
                    });
                }
            });

            const tables: Array<{
                sectionTitle?: string;
                columns: string[];
                rows: (string | number)[][];
                columnStyles?: { [key: number]: any };
            }> = [
                {
                    sectionTitle: 'Active Systematic Investment Mandates',
                    columns: ['Plan Name', 'Category', 'Freq', 'Debit Day', 'Amount', 'Next Date', 'Step-Up', 'Status'],
                    rows: planRows,
                    columnStyles: { 4: { halign: 'right' } }
                }
            ];

            if (ledgerRows.length > 0) {
                tables.push({
                    sectionTitle: 'Auto-Debit Execution Audit Trail',
                    columns: ['Execution Date', 'Plan Name', 'Scheduled Date', 'Status', 'Amount', 'Units', 'NAV / Price'],
                    rows: ledgerRows.slice(0, 100),
                    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
                });
            }

            await this.generatePdf(
                meta,
                metrics,
                tables,
                `FinTracker_SIP_Statement_${dateStr}.pdf`
            );
        } else {
            const planCols = [
                { header: 'Plan Name', key: 'name', width: 32 },
                { header: 'Category', key: 'category', width: 16 },
                { header: 'Frequency', key: 'frequency', width: 14 },
                { header: 'Debit Day', key: 'sipDay', width: 12 },
                { header: 'Installment Amount', key: 'amount', width: 18 },
                { header: 'Next Execution Date', key: 'nextExecutionDate', width: 18 },
                { header: 'Annual Step-Up', key: 'stepUp', width: 16 },
                { header: 'Status', key: 'status', width: 14 }
            ];

            const planRows = data.sips.map((s: any) => ({
                name: s.name || '',
                category: s.category || '',
                frequency: s.frequency || 'Monthly',
                sipDay: s.sipDay || '',
                amount: s.amount || 0,
                nextExecutionDate: s.nextExecutionDate || '',
                stepUp: s.stepUp?.enabled ? `+${s.stepUp.value}%` : 'None',
                status: s.status || 'Active'
            }));

            const ledgerCols = [
                { header: 'Execution Date', key: 'executionDate', width: 16 },
                { header: 'Plan Name', key: 'planName', width: 30 },
                { header: 'Scheduled Date', key: 'scheduledDate', width: 16 },
                { header: 'Status', key: 'status', width: 14 },
                { header: 'Amount Debited', key: 'amount', width: 16 },
                { header: 'Units Allotted', key: 'units', width: 14 },
                { header: 'NAV / Unit Price', key: 'price', width: 16 }
            ];

            const ledgerRows: any[] = [];
            data.sips.forEach((s: any) => {
                const list = s.installments || s.installmentHistory;
                if (list && Array.isArray(list)) {
                    list.forEach((inst: any) => {
                        ledgerRows.push({
                            executionDate: inst.executionDate || inst.scheduledDate || '',
                            planName: s.name,
                            scheduledDate: inst.scheduledDate || '',
                            status: inst.status || 'Success',
                            amount: inst.amount || 0,
                            units: inst.unitsAllotted || 0,
                            price: inst.navOrPrice || 0
                        });
                    });
                }
            });

            await this.generateExcel(
                meta,
                metrics,
                [
                    { sheetName: 'SIP Mandates', columns: planCols, rows: planRows },
                    { sheetName: 'Execution Ledger', columns: ledgerCols, rows: ledgerRows }
                ],
                `FinTracker_SIP_Statement_${dateStr}.xlsx`
            );
        }
    }
}

