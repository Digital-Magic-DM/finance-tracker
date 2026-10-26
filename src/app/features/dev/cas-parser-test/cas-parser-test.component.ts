import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CasParserService, CasParseResult, CasPasswordRequiredError } from '../../../services/cas-parser.service';

@Component({
  selector: 'app-cas-parser-test',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cas-parser-test.component.html',
  styleUrls: ['./cas-parser-test.component.scss'],
})
export class CasParserTestComponent {
  private casParser = inject(CasParserService);

  readonly isLocalhost = signal<boolean>(
    typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.'))
  );

  readonly selectedFile = signal<File | null>(null);
  readonly isParsing = signal<boolean>(false);
  readonly isDragging = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly parseResult = signal<CasParseResult | null>(null);

  readonly activeTab = signal<'equities' | 'mutualFunds' | 'bonds' | 'rawLines' | 'logs'>('equities');
  readonly searchQuery = signal<string>('');
  readonly rawSearchQuery = signal<string>('');

  readonly showPasswordModal = signal<boolean>(false);
  password = '';
  readonly passwordError = signal<string | null>(null);
  readonly copiedJson = signal<boolean>(false);
  readonly maskPan = signal<boolean>(true);

  // ── Drag & Drop ──
  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragging.set(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  private async handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      this.errorMessage.set('Please select a valid PDF statement file.');
      return;
    }
    this.selectedFile.set(file);
    this.errorMessage.set(null);
    this.password = '';
    this.passwordError.set(null);
    await this.runParser(file);
  }

  async submitPassword() {
    if (!this.selectedFile()) return;
    this.passwordError.set(null);
    await this.runParser(this.selectedFile()!, this.password);
  }

  closePasswordModal() {
    this.showPasswordModal.set(false);
    this.password = '';
    this.passwordError.set(null);
  }

  private async runParser(file: File, pwd?: string) {
    this.isParsing.set(true);
    try {
      const result = await this.casParser.parsePdf(file, pwd);
      this.parseResult.set(result);
      this.showPasswordModal.set(false);
      this.password = '';
    } catch (err: any) {
      if (err instanceof CasPasswordRequiredError || err?.name === 'CasPasswordRequiredError') {
        this.showPasswordModal.set(true);
        if (err.isIncorrect) {
          this.passwordError.set(err.message || 'Incorrect password.');
        }
      } else {
        this.errorMessage.set(err?.message || 'Failed to parse PDF statement.');
      }
    } finally {
      this.isParsing.set(false);
    }
  }

  reset() {
    this.selectedFile.set(null);
    this.parseResult.set(null);
    this.errorMessage.set(null);
    this.password = '';
    this.passwordError.set(null);
    this.showPasswordModal.set(false);
    this.searchQuery.set('');
    this.rawSearchQuery.set('');
    this.activeTab.set('equities');
  }

  copyJson() {
    const res = this.parseResult();
    if (!res) return;
    navigator.clipboard.writeText(JSON.stringify(res, null, 2)).then(() => {
      this.copiedJson.set(true);
      setTimeout(() => this.copiedJson.set(false), 2000);
    });
  }

  downloadJson() {
    const res = this.parseResult();
    if (!res) return;
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cas_parsed_${res.metadata.depository}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  loadSampleData() {
    const sample: CasParseResult = {
      success: true,
      parseDurationMs: 142,
      metadata: {
        depository: 'CDSL',
        investorName: 'SAMPLE INVESTOR',
        pan: 'ABCDE1234F',
        email: 'investor@example.com',
        statementPeriod: '01-Jan-2025 to 31-Jan-2025',
        statementDate: '31-Jan-2025',
        dematAccounts: ['1208160012345678'],
        totalRecordsCount: 6,
      },
      summary: {
        totalEquityValue: 452100,
        totalDematMutualFundValue: 101354,
        totalSoaMutualFundValue: 184046,
        totalMutualFundValue: 285400,
        totalBondValue: 50000,
        totalOtherValue: 50000,
        totalPortfolioValue: 787500,
        equitiesCount: 3,
        dematMutualFundsCount: 1,
        soaMutualFundsCount: 1,
        mutualFundsCount: 2,
        bondsCount: 1,
        otherCount: 1,
        unparsedHoldingsCount: 0,
        declaredSummary: {
          totalValuation: 787500,
          equityValuation: 452100,
          mutualFundValuation: 285400,
          bondValuation: 50000,
          source: 'Depository Portfolio Summary Table',
          isReconciled: true,
          difference: 0,
          reconciliationNote: 'Exact mathematical match! Calculated holdings total ₹787500.00 matches declared statement total ₹787500.00.',
        },
      },
      equities: [
        {
          isin: 'INE002A01018',
          companyName: 'RELIANCE INDUSTRIES LTD',
          symbol: 'RELIANCE',
          quantity: 100,
          marketPrice: 2450.5,
          totalValue: 245050,
          holdingType: 'Equity',
        },
        {
          isin: 'INE009A01021',
          companyName: 'INFOSYS LTD',
          symbol: 'INFY',
          quantity: 80,
          marketPrice: 1850.0,
          totalValue: 148000,
          holdingType: 'Equity',
        },
        {
          isin: 'INF732E01037',
          companyName: 'NIPPON INDIA ETF NIFTY BEES',
          symbol: 'NIFTYBEES',
          quantity: 250,
          marketPrice: 236.2,
          totalValue: 59050,
          holdingType: 'ETF',
        },
      ],
      mutualFunds: [
        {
          holdingLocation: 'SOA',
          amc: 'Parag Parikh Mutual Fund',
          folio: '12345678/90',
          schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01019',
          units: 2540.321,
          nav: 72.45,
          costValue: 150000,
          marketValue: 184046,
          gainLoss: 34046,
          gainLossPct: 22.7,
          planType: 'Direct',
        },
        {
          holdingLocation: 'DEMAT',
          dematAccount: '1208160012345678',
          amc: 'Mirae Asset Mutual Fund',
          folio: '1208160012345678',
          schemeName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth',
          isin: 'INF769K01010',
          units: 1050.12,
          nav: 96.52,
          costValue: 85000,
          marketValue: 101354,
          gainLoss: 16354,
          gainLossPct: 19.24,
          planType: 'Direct',
        },
      ],
      dematMutualFunds: [
        {
          holdingLocation: 'DEMAT',
          dematAccount: '1208160012345678',
          amc: 'Mirae Asset Mutual Fund',
          folio: '1208160012345678',
          schemeName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth',
          isin: 'INF769K01010',
          units: 1050.12,
          nav: 96.52,
          costValue: 85000,
          marketValue: 101354,
          gainLoss: 16354,
          gainLossPct: 19.24,
          planType: 'Direct',
        },
      ],
      soaMutualFunds: [
        {
          holdingLocation: 'SOA',
          amc: 'Parag Parikh Mutual Fund',
          folio: '12345678/90',
          schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01019',
          units: 2540.321,
          nav: 72.45,
          costValue: 150000,
          marketValue: 184046,
          gainLoss: 34046,
          gainLossPct: 22.7,
          planType: 'Direct',
        },
      ],
      bonds: [
        {
          isin: 'IN0020210098',
          securityName: 'SOVEREIGN GOLD BOND 2021-22 SERIES IX',
          quantity: 8,
          faceValue: 4791,
          marketPrice: 6250,
          totalValue: 50000,
          assetSubtype: 'SGB',
        },
      ],
      otherAssets: [
        {
          isin: 'IN0020210098',
          securityName: 'SOVEREIGN GOLD BOND 2021-22 SERIES IX',
          quantity: 8,
          faceValue: 4791,
          marketPrice: 6250,
          totalValue: 50000,
          assetSubtype: 'SGB',
        },
      ],
      unparsedHoldings: [],
      rawLines: [
        'CENTRAL DEPOSITORY SERVICES (INDIA) LIMITED',
        'Consolidated Account Statement',
        'Statement Period : 01-Jan-2025 To 31-Jan-2025',
        'PAN: ABCDE1234F Name: SAMPLE INVESTOR',
        'Total Portfolio Valuation : 7,87,500.00',
        'INE002A01018 RELIANCE INDUSTRIES LTD 100 2,450.50 2,45,050.00',
        'INE009A01021 INFOSYS LTD 80 1,850.00 1,48,000.00',
        'INF732E01037 NIPPON INDIA ETF NIFTY BEES 250 236.20 59,050.00',
        'INF879O01019 Parag Parikh Flexi Cap Fund Direct Growth 2540.321 72.45 1,84,046.00',
        'IN0020210098 SOVEREIGN GOLD BOND 2021-22 SERIES IX 8 6,250.00 50,000.00',
      ],
      logs: [
        '[10:00:00.100] Starting CAS PDF parse (Sample Data)',
        '[10:00:00.110] Identified statement format: CDSL',
        '[10:00:00.120] Metadata: Investor=SAMPLE INVESTOR, PAN=ABCDE1234F',
        '[10:00:00.130] Extracted Declared Total Portfolio Valuation: ₹787500',
        '[10:00:00.140] ✓ Mathematical reconciliation confirmed! Parsed total ₹787500.00 matches declared statement total ₹787500.00.',
      ],
    };
    this.parseResult.set(sample);
  }

  // ── Filters & Computed ──
  readonly filteredEquities = computed(() => {
    const res = this.parseResult();
    if (!res) return [];
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return res.equities;
    return res.equities.filter(
      (e) =>
        e.companyName.toLowerCase().includes(q) ||
        e.isin.toLowerCase().includes(q) ||
        (e.symbol && e.symbol.toLowerCase().includes(q))
    );
  });

  readonly equityTotal = computed(() => {
    return this.filteredEquities().reduce((acc, e) => acc + e.totalValue, 0);
  });

  readonly filteredMutualFunds = computed(() => {
    const res = this.parseResult();
    if (!res) return [];
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return res.mutualFunds;
    return res.mutualFunds.filter(
      (m) =>
        m.schemeName.toLowerCase().includes(q) ||
        m.isin.toLowerCase().includes(q) ||
        m.folio.toLowerCase().includes(q) ||
        (m.amc && m.amc.toLowerCase().includes(q))
    );
  });

  readonly mfTotal = computed(() => {
    return this.filteredMutualFunds().reduce((acc, m) => acc + m.marketValue, 0);
  });

  readonly filteredBonds = computed(() => {
    const res = this.parseResult();
    if (!res) return [];
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return res.bonds;
    return res.bonds.filter(
      (b) => b.securityName.toLowerCase().includes(q) || b.isin.toLowerCase().includes(q)
    );
  });

  readonly bondTotal = computed(() => {
    return this.filteredBonds().reduce((acc, b) => acc + b.totalValue, 0);
  });

  readonly filteredRawLines = computed(() => {
    const res = this.parseResult();
    if (!res) return [];
    const q = this.rawSearchQuery().toLowerCase().trim();
    const mapped = res.rawLines.map((line, idx) => ({ idx: idx + 1, line }));
    if (!q) return mapped;
    return mapped.filter((item) => item.line.toLowerCase().includes(q));
  });

  toggleMaskPan() {
    this.maskPan.update((v) => !v);
  }

  getMaskedPan(pan?: string): string {
    if (!pan) return 'N/A';
    if (!this.maskPan()) return pan;
    if (pan.length <= 4) return '••••';
    return pan.slice(0, 2) + '••••' + pan.slice(-2);
  }
}
