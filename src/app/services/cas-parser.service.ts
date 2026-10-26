import { Injectable, inject } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { TickerRegistryService } from './ticker-registry.service';

// Configure PDF.js worker
// @ts-ignore - Dynamic import warning suppressed for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface CasMetadata {
  depository: 'CDSL' | 'NSDL' | 'CAMS/KFintech' | 'Unknown';
  rtas?: string[];
  investorName?: string;
  pan?: string;
  email?: string;
  statementPeriod?: string;
  statementDate?: string;
  dematAccounts: string[];
  totalRecordsCount: number;
}

export interface CasEquityHolding {
  isin: string;
  companyName: string;
  symbol?: string;
  quantity: number;
  faceValue?: number;
  marketPrice: number;
  totalValue: number;
  holdingType: 'Equity' | 'ETF' | 'REIT' | 'SGB';
  dematAccount?: string;
}

export interface CasMutualFundHolding {
  holdingLocation: 'DEMAT' | 'SOA';
  dematAccount?: string;
  amc?: string;
  folio: string;
  schemeName: string;
  isin: string;
  units: number;
  nav: number;
  navDate?: string;
  costValue?: number;
  marketValue: number;
  gainLoss?: number;
  gainLossPct?: number;
  planType: 'Direct' | 'Regular' | 'Unknown';
}

export interface CasOtherHolding {
  isin: string;
  securityName: string;
  dematAccount?: string;
  quantity: number;
  faceValue?: number;
  marketPrice: number;
  totalValue: number;
  assetSubtype: 'SGB' | 'InvIT' | 'REIT' | 'Bond' | 'G-Sec' | 'Other';
}

// Type alias for backward compatibility
export type CasBondHolding = CasOtherHolding;

export interface CasCategoryReconciliation {
  declaredValue: number;
  calculatedValue: number;
  difference: number;
  isReconciled: boolean;
}

export interface CasDeclaredSummary {
  totalValuation?: number;
  equityValuation?: number;
  mutualFundValuation?: number;
  dematMutualFundValuation?: number;
  soaMutualFundValuation?: number;
  bondValuation?: number;
  otherValuation?: number;
  source: string;
  isReconciled?: boolean;
  difference?: number;
  reconciliationNote?: string;
  categories?: {
    equity?: CasCategoryReconciliation;
    dematMutualFund?: CasCategoryReconciliation;
    soaMutualFund?: CasCategoryReconciliation;
    mutualFund?: CasCategoryReconciliation;
    otherAssets?: CasCategoryReconciliation;
  };
}

export interface CasSummary {
  totalEquityValue: number;
  totalDematMutualFundValue: number;
  totalSoaMutualFundValue: number;
  totalMutualFundValue: number;
  totalBondValue: number;
  totalOtherValue: number;
  totalPortfolioValue: number;
  equitiesCount: number;
  dematMutualFundsCount: number;
  soaMutualFundsCount: number;
  mutualFundsCount: number;
  bondsCount: number;
  otherCount: number;
  declaredSummary?: CasDeclaredSummary;
  unparsedHoldingsCount?: number;
}

export interface CasUnparsedRow {
  line: string;
  isin: string;
  section: string;
  reason: string;
}

export interface CasParseResult {
  success: boolean;
  metadata: CasMetadata;
  summary: CasSummary;
  equities: CasEquityHolding[];
  mutualFunds: CasMutualFundHolding[];
  dematMutualFunds: CasMutualFundHolding[];
  soaMutualFunds: CasMutualFundHolding[];
  bonds: CasBondHolding[];
  otherAssets: CasOtherHolding[];
  unparsedHoldings: CasUnparsedRow[];
  rawLines: string[];
  logs: string[];
  parseDurationMs: number;
}

export class CasPasswordRequiredError extends Error {
  isIncorrect: boolean;
  constructor(message: string, isIncorrect = false) {
    super(message);
    this.name = 'CasPasswordRequiredError';
    this.isIncorrect = isIncorrect;
  }
}

enum CasSectionMode {
  METADATA_OR_SUMMARY = 'METADATA_OR_SUMMARY',
  HOLDINGS_DEMAT = 'HOLDINGS_DEMAT',
  HOLDINGS_EQUITY = 'HOLDINGS_EQUITY',
  HOLDINGS_MUTUAL_FUND_DEMAT = 'HOLDINGS_MUTUAL_FUND_DEMAT',
  HOLDINGS_BOND_OR_OTHER = 'HOLDINGS_BOND_OR_OTHER',
  MUTUAL_FUNDS_SOA = 'MUTUAL_FUNDS_SOA',
  TRANSACTIONS = 'TRANSACTIONS',
}

@Injectable({
  providedIn: 'root',
})
export class CasParserService {
  private tickerRegistry = inject(TickerRegistryService);

  /**
   * Parse a CDSL / NSDL eCAS or Mutual Fund CAS PDF with optional password
   */
  async parsePdf(file: File, password?: string): Promise<CasParseResult> {
    const startTime = performance.now();
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
    };

    log(`Starting CAS PDF parse: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
    await this.tickerRegistry.ensureLoaded();

    const data = await this.readFileAsArrayBuffer(file);
    let pdf: any;

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(data),
        password: password || undefined,
      });
      pdf = await loadingTask.promise;
    } catch (err: unknown) {
      const errorObj = err as any;
      if (errorObj?.name === 'PasswordException' || errorObj?.code === 1 || errorObj?.code === 2) {
        const isIncorrect = !!password || errorObj?.code === 2;
        log(`Password required or incorrect (code: ${errorObj?.code})`);
        throw new CasPasswordRequiredError(
          isIncorrect
            ? 'Incorrect password. CDSL/NSDL eCAS statements typically use your PAN (lowercase or uppercase) or DOB (DDMMYYYY).'
            : 'Password protected statement. Please enter your password to unlock (typically your PAN or DOB).',
          isIncorrect
        );
      }
      throw err;
    }

    log(`PDF unlocked successfully. Total Pages: ${pdf.numPages}`);

    // Extract text grouped into visual lines with 4px vertical clustering
    const rawLines: string[] = [];
    let fullPdfText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = (textContent.items as any[])
        .map((it) => ({
          str: it.str.trim(),
          raw: it.str,
          x: Math.round(it.transform[4]),
          y: Math.round(it.transform[5]),
        }))
        .filter((it) => it.raw.length > 0);

      // Group text items with 4px Y tolerance for baseline variations
      const lineGroups = new Map<number, any[]>();
      for (const item of items) {
        let foundKey: number | null = null;
        for (const key of lineGroups.keys()) {
          if (Math.abs(key - item.y) <= 4) {
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
        const lineStr = rowItems
          .map((it) => it.str)
          .filter(Boolean)
          .join(' ');
        if (lineStr.trim()) {
          rawLines.push(lineStr.trim());
          fullPdfText += '\n' + lineStr.trim();
        }
      }
    }

    log(`Extracted ${rawLines.length} visual text lines across ${pdf.numPages} pages`);

    // 1. Identify Depository, Investor Details, and Accounts
    const metadata = this.extractMetadata(rawLines, fullPdfText, log);

    // 2. Extract Declared Portfolio Summary (Page 1-3 macro summary)
    const declaredSummary = this.extractDeclaredSummary(rawLines, log);

    // 3. Parse Holdings across Statement of Holdings (Ignoring Transactions!)
    const equities: CasEquityHolding[] = [];
    const dematMutualFunds: CasMutualFundHolding[] = [];
    const soaMutualFunds: CasMutualFundHolding[] = [];
    const otherAssets: CasOtherHolding[] = [];
    const unparsedHoldings: CasUnparsedRow[] = [];

    this.parseSections(
      rawLines,
      equities,
      dematMutualFunds,
      soaMutualFunds,
      otherAssets,
      unparsedHoldings,
      log
    );

    // 4. Post-Process & Normalize Holdings
    const normalizedEquities = this.normalizeEquities(equities, log);
    const normalizedDematMFs = this.normalizeMutualFunds(dematMutualFunds, log);
    const normalizedSoaMFs = this.normalizeMutualFunds(soaMutualFunds, log);
    const normalizedOthers = this.normalizeOtherAssets(otherAssets, log);

    // Consolidated mutual funds list retaining location identity
    const allMutualFunds = [...normalizedDematMFs, ...normalizedSoaMFs];

    // 5. Calculate Final Summary
    const totalEquityValue = normalizedEquities.reduce((s, e) => s + e.totalValue, 0);
    const totalDematMfValue = normalizedDematMFs.reduce((s, m) => s + m.marketValue, 0);
    const totalSoaMfValue = normalizedSoaMFs.reduce((s, m) => s + m.marketValue, 0);
    const totalMutualFundValue = totalDematMfValue + totalSoaMfValue;
    const totalOtherValue = normalizedOthers.reduce((s, b) => s + b.totalValue, 0);
    const totalPortfolioValue = totalEquityValue + totalMutualFundValue + totalOtherValue;

    // Strict, source-aware mathematical reconciliation (tolerance <= ₹1.00 for rounding differences)
    if (declaredSummary && declaredSummary.totalValuation) {
      const declaredTotal = declaredSummary.totalValuation;
      const totalDiff = Math.abs(totalPortfolioValue - declaredTotal);
      declaredSummary.difference = Math.round(totalDiff * 100) / 100;
      declaredSummary.isReconciled = totalDiff <= 1.00;

      let note = '';
      if (totalDiff === 0) {
        note = `Exact mathematical match! Calculated holdings total ₹${totalPortfolioValue.toFixed(2)} matches declared statement total ₹${declaredTotal.toFixed(2)}.`;
      } else if (totalDiff <= 1.00) {
        note = `Exact match within rounding difference (diff: ₹${totalDiff.toFixed(2)}). Calculated ₹${totalPortfolioValue.toFixed(2)} vs declared ₹${declaredTotal.toFixed(2)}.`;
      } else {
        note = `Reconciliation discrepancy of ₹${totalDiff.toFixed(2)}. Calculated ₹${totalPortfolioValue.toFixed(2)} vs declared ₹${declaredTotal.toFixed(2)}.`;
      }
      declaredSummary.reconciliationNote = note;
      log(declaredSummary.isReconciled ? `✓ ${note}` : `ℹ ${note}`);

      // Category-level reconciliation
      declaredSummary.categories = {};
      if (declaredSummary.equityValuation !== undefined) {
        const eqDiff = Math.abs(totalEquityValue - declaredSummary.equityValuation);
        declaredSummary.categories.equity = {
          declaredValue: declaredSummary.equityValuation,
          calculatedValue: Math.round(totalEquityValue * 100) / 100,
          difference: Math.round(eqDiff * 100) / 100,
          isReconciled: eqDiff <= 1.00,
        };
      }
      if (declaredSummary.dematMutualFundValuation !== undefined) {
        const dDiff = Math.abs(totalDematMfValue - declaredSummary.dematMutualFundValuation);
        declaredSummary.categories.dematMutualFund = {
          declaredValue: declaredSummary.dematMutualFundValuation,
          calculatedValue: Math.round(totalDematMfValue * 100) / 100,
          difference: Math.round(dDiff * 100) / 100,
          isReconciled: dDiff <= 1.00,
        };
      }
      if (declaredSummary.soaMutualFundValuation !== undefined) {
        const sDiff = Math.abs(totalSoaMfValue - declaredSummary.soaMutualFundValuation);
        declaredSummary.categories.soaMutualFund = {
          declaredValue: declaredSummary.soaMutualFundValuation,
          calculatedValue: Math.round(totalSoaMfValue * 100) / 100,
          difference: Math.round(sDiff * 100) / 100,
          isReconciled: sDiff <= 1.00,
        };
      }
      if (declaredSummary.otherValuation !== undefined || declaredSummary.bondValuation !== undefined) {
        const decVal = declaredSummary.otherValuation ?? declaredSummary.bondValuation ?? 0;
        const oDiff = Math.abs(totalOtherValue - decVal);
        declaredSummary.categories.otherAssets = {
          declaredValue: decVal,
          calculatedValue: Math.round(totalOtherValue * 100) / 100,
          difference: Math.round(oDiff * 100) / 100,
          isReconciled: oDiff <= 1.00,
        };
      }
    }

    const summary: CasSummary = {
      totalEquityValue: Math.round(totalEquityValue * 100) / 100,
      totalDematMutualFundValue: Math.round(totalDematMfValue * 100) / 100,
      totalSoaMutualFundValue: Math.round(totalSoaMfValue * 100) / 100,
      totalMutualFundValue: Math.round(totalMutualFundValue * 100) / 100,
      totalBondValue: Math.round(totalOtherValue * 100) / 100,
      totalOtherValue: Math.round(totalOtherValue * 100) / 100,
      totalPortfolioValue: Math.round(totalPortfolioValue * 100) / 100,
      equitiesCount: normalizedEquities.length,
      dematMutualFundsCount: normalizedDematMFs.length,
      soaMutualFundsCount: normalizedSoaMFs.length,
      mutualFundsCount: allMutualFunds.length,
      bondsCount: normalizedOthers.length,
      otherCount: normalizedOthers.length,
      declaredSummary: declaredSummary || undefined,
      unparsedHoldingsCount: unparsedHoldings.length,
    };

    metadata.totalRecordsCount =
      summary.equitiesCount + summary.mutualFundsCount + summary.otherCount;

    const parseDurationMs = Math.round(performance.now() - startTime);
    log(
      `Parse completed in ${parseDurationMs}ms: Found ${summary.equitiesCount} Equities (₹${summary.totalEquityValue.toLocaleString('en-IN')}), ${summary.dematMutualFundsCount} Demat MFs (₹${summary.totalDematMutualFundValue.toLocaleString('en-IN')}), ${summary.soaMutualFundsCount} SOA MFs (₹${summary.totalSoaMutualFundValue.toLocaleString('en-IN')}), ${summary.otherCount} Other/SGB/Bonds (₹${summary.totalOtherValue.toLocaleString('en-IN')})`
    );

    return {
      success: true,
      metadata,
      summary,
      equities: normalizedEquities,
      mutualFunds: allMutualFunds,
      dematMutualFunds: normalizedDematMFs,
      soaMutualFunds: normalizedSoaMFs,
      bonds: normalizedOthers,
      otherAssets: normalizedOthers,
      unparsedHoldings,
      rawLines,
      logs,
      parseDurationMs,
    };
  }

  /**
   * Extract depository type (issuer header prioritized), RTAs, investor PAN, name, Demat IDs, and statement period
   */
  private extractMetadata(lines: string[], fullText: string, log: (m: string) => void): CasMetadata {
    // 1. Prioritize issuer from top 40 header lines so RTA mentions (e.g. CAMS) don't misclassify CDSL/NSDL
    const headerLines = lines.slice(0, 40).join(' ').toLowerCase();
    let depository: CasMetadata['depository'] = 'Unknown';

    if (headerLines.includes('central depository services') || headerLines.includes('cdsl')) {
      depository = 'CDSL';
    } else if (headerLines.includes('national securities depository') || headerLines.includes('nsdl')) {
      depository = 'NSDL';
    } else if (
      headerLines.includes('computer age management') ||
      (headerLines.includes('cams') && !headerLines.includes('cdsl') && !headerLines.includes('nsdl')) ||
      headerLines.includes('kfintech') ||
      headerLines.includes('karvy')
    ) {
      depository = 'CAMS/KFintech';
    } else {
      // Fallback search
      const lowerFull = fullText.toLowerCase();
      if (lowerFull.includes('central depository services') || lowerFull.includes('cdsl')) {
        depository = 'CDSL';
      } else if (lowerFull.includes('national securities depository') || lowerFull.includes('nsdl')) {
        depository = 'NSDL';
      } else if (lowerFull.includes('cams') || lowerFull.includes('kfintech')) {
        depository = 'CAMS/KFintech';
      }
    }

    log(`Identified statement issuer: ${depository}`);

    // Detect RTA(s) separately
    const rtas: string[] = [];
    const upperFull = fullText.toUpperCase();
    if (upperFull.includes('CAMS') || upperFull.includes('COMPUTER AGE MANAGEMENT')) {
      rtas.push('CAMS');
    }
    if (upperFull.includes('KFINTECH') || upperFull.includes('KARVY')) {
      rtas.push('KFintech');
    }
    if (upperFull.includes('FRANKLIN TEMPLETON')) {
      rtas.push('Franklin Templeton');
    }

    // Extract PAN
    const panMatch = fullText.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
    const pan = panMatch ? panMatch[1] : undefined;

    // Extract Email
    const emailMatch = fullText.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    const email = emailMatch ? emailMatch[1] : undefined;

    // Extract Demat Account / BO ID numbers (e.g., 120... for CDSL or IN30... for NSDL)
    const dematAccounts: string[] = [];
    const boidMatches = fullText.matchAll(/\b(120\d{13}|130\d{13}|IN30\d{14}|IN\d{14})\b/g);
    for (const m of boidMatches) {
      if (!dematAccounts.includes(m[1])) {
        dematAccounts.push(m[1]);
      }
    }

    // Statement Period
    let statementPeriod: string | undefined;
    const periodMatch = fullText.match(
      /(?:statement for the (?:month|period)(?: of)?|period\s*[:.-]?)\s*([A-Za-z0-9,\s-]{5,35})/i
    );
    if (periodMatch) {
      statementPeriod = periodMatch[1].replace(/\s+/g, ' ').trim();
    }

    // Statement Date (supporting dot, dash, slash)
    let statementDate: string | undefined;
    const dateMatch = fullText.match(
      /(?:as on|statement date|generated on|holding statement as on)\s*[:.-]?\s*(\d{1,2}[./-][A-Za-z0-9]+[./-]\d{2,4})/i
    );
    if (dateMatch) {
      statementDate = dateMatch[1];
    }

    // Investor Name
    const investorName = this.extractInvestorName(lines, fullText);

    log(
      `Metadata: Depository=${depository}, RTAs=${rtas.join(', ') || 'None'}, Investor=${investorName || 'Unknown'}, PAN=${pan || 'Not found'}, Demat Accounts=${dematAccounts.join(', ') || 'None'}`
    );

    return {
      depository,
      rtas: rtas.length > 0 ? rtas : undefined,
      investorName,
      pan,
      email,
      statementPeriod,
      statementDate,
      dematAccounts,
      totalRecordsCount: 0,
    };
  }

  /**
   * Extract investor name with precision, rejecting stop words like "of", "the", "statement"
   */
  private extractInvestorName(lines: string[], fullText: string): string | undefined {
    const directPatterns = [
      /(?:Name of (?:the )?(?:Sole\s*\/\s*)?First Holder|First Holder Name|Name of Investor|Investor Name)\s*[:.-]?\s*([A-Za-z\s.]{3,45})/i,
      /(?:Account Holder(?:\(s\))?|Sole\s*\/\s*First Holder)\s*[:.-]?\s*([A-Za-z\s.]{3,45})/i,
      /Dear\s+(?:Mr\.|Ms\.|Mrs\.)?\s*([A-Za-z\s.]{3,40})(?:\s*,\s*|\n)/i,
    ];

    for (const pat of directPatterns) {
      const match = fullText.match(pat);
      if (match && match[1]) {
        const cleaned = this.cleanInvestorName(match[1]);
        if (cleaned) return cleaned;
      }
    }

    // Line by line scanning in header (first 40 lines)
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const line = lines[i];
      if (
        /name\s*[:.-]/i.test(line) &&
        !line.toUpperCase().includes('DEPOSITORY') &&
        !line.toUpperCase().includes('SCHEME')
      ) {
        const parts = line.split(/[:.-]/);
        if (parts.length >= 2) {
          const cand = this.cleanInvestorName(parts.slice(1).join(' '));
          if (cand) return cand;
        }
      }
    }

    return undefined;
  }

  private cleanInvestorName(raw: string): string | undefined {
    const withoutSuffixes = raw
      .replace(/\b(PAN|DOB|MOBILE|EMAIL|ADDRESS|NOMINEE|STATUS|FOLIO|BOID|DPID|CLIENT|DEMAT)\b.*/i, '')
      .replace(/[,;]/g, ' ')
      .trim();

    const words = withoutSuffixes.split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;

    const stopWords = new Set([
      'OF',
      'THE',
      'FIRST',
      'SOLE',
      'HOLDER',
      'NAME',
      'INVESTOR',
      'UNKNOWN',
      'STATEMENT',
      'DEPOSITORY',
      'CENTRAL',
      'SERVICES',
      'LIMITED',
      'NATIONAL',
      'SECURITIES',
    ]);

    const upper = withoutSuffixes.toUpperCase();
    if (stopWords.has(upper) || upper.startsWith('STATEMENT OF') || upper.startsWith('CDSL')) {
      return undefined;
    }

    if (withoutSuffixes.length < 3 || withoutSuffixes.length > 50) return undefined;
    return withoutSuffixes;
  }

  /**
   * Extract Declared Executive Portfolio Summary (Page 1-3 macro summary table)
   * Capturing Equities, Demat MFs, SOA MFs, Other Assets, and Total Portfolio Valuation
   */
  private extractDeclaredSummary(lines: string[], log: (m: string) => void): CasDeclaredSummary | null {
    let totalVal: number | undefined;
    let equityVal: number | undefined;
    let dematMfVal: number | undefined;
    let soaMfVal: number | undefined;
    let mfVal: number | undefined;
    let otherVal: number | undefined;

    const scanLimit = Math.min(lines.length, 250);

    for (let i = 0; i < scanLimit; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Skip lines with ISINs or headers
      if (/\b(IN[A-Z0-9]{10})\b/.test(line)) continue;

      // Total Portfolio Valuation
      if (
        lower.includes('total portfolio valuation') ||
        lower.includes('total portfolio value') ||
        lower.includes('total holdings portfolio value') ||
        (lower.includes('total') && lower.includes('portfolio') && !lower.includes('sub total'))
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && !totalVal) {
          totalVal = nums[nums.length - 1];
          log(`Extracted Declared Total Portfolio Valuation: ₹${totalVal}`);
        }
      }

      // Equity total
      if (
        (lower.startsWith('equit') ||
          lower.includes('total equity') ||
          lower.includes('equity shares') ||
          lower.includes('equities / etfs')) &&
        !lower.includes('isin') &&
        !equityVal
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && nums[nums.length - 1] > 0) {
          equityVal = nums[nums.length - 1];
        }
      }

      // Demat Mutual Funds
      if (
        (lower.includes('mutual fund units held in demat') ||
          lower.includes('mutual funds in demat') ||
          lower.includes('mutual fund - demat') ||
          (lower.includes('mutual fund') && lower.includes('demat'))) &&
        !dematMfVal
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && nums[nums.length - 1] > 0) {
          dematMfVal = nums[nums.length - 1];
        }
      }

      // SOA Mutual Funds
      if (
        (lower.includes('mutual fund units held in statement of account') ||
          lower.includes('mutual funds in statement of account') ||
          lower.includes('mutual fund - soa') ||
          (lower.includes('statement of account') && lower.includes('mutual fund')) ||
          lower.includes('mutual fund folios')) &&
        !soaMfVal
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && nums[nums.length - 1] > 0) {
          soaMfVal = nums[nums.length - 1];
        }
      }

      // Generic Mutual Fund total (if not broken down or summary)
      if (
        (lower.startsWith('mutual fund') || lower.includes('total mutual fund')) &&
        !lower.includes('isin') &&
        !lower.includes('units') &&
        !mfVal
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && nums[nums.length - 1] > 0) {
          mfVal = nums[nums.length - 1];
        }
      }

      // Other assets / Corporate Bonds / Government Securities / SGB / InvIT
      if (
        (lower.includes('corporate bond') ||
          lower.includes('government securit') ||
          lower.includes('sovereign gold') ||
          lower.includes('bonds / debentures') ||
          lower.includes('other assets') ||
          lower.includes('invit') ||
          lower.includes('reit')) &&
        !lower.includes('isin')
      ) {
        const nums = this.extractAllNumbers(line);
        if (nums.length > 0 && nums[nums.length - 1] > 0) {
          otherVal = (otherVal || 0) + nums[nums.length - 1];
        }
      }
    }

    if (totalVal !== undefined && totalVal > 0) {
      return {
        totalValuation: totalVal,
        equityValuation: equityVal,
        dematMutualFundValuation: dematMfVal,
        soaMutualFundValuation: soaMfVal,
        mutualFundValuation: mfVal ?? (dematMfVal && soaMfVal ? dematMfVal + soaMfVal : undefined),
        bondValuation: otherVal,
        otherValuation: otherVal,
        source: 'Depository Portfolio Summary Table',
      };
    }

    return null;
  }

  /**
   * Parse sections across lines with strict state-machine isolation
   * Transaction history sections are strictly ignored to prevent double-counting.
   */
  private parseSections(
    lines: string[],
    equities: CasEquityHolding[],
    dematMutualFunds: CasMutualFundHolding[],
    soaMutualFunds: CasMutualFundHolding[],
    otherAssets: CasOtherHolding[],
    unparsedHoldings: CasUnparsedRow[],
    log: (m: string) => void
  ) {
    let currentMode = CasSectionMode.METADATA_OR_SUMMARY;
    const ISIN_REGEX = /\b(IN[A-Z0-9]{10})\b/;

    let currentAmc = '';
    let currentFolio = '';
    let currentDematAccount = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      const hasIsin = ISIN_REGEX.test(line);

      // Extract Demat BOID if present in header/account line
      const boMatch = line.match(/\b(120\d{13}|130\d{13}|IN30\d{14}|IN\d{14})\b/);
      if (
        boMatch &&
        (lower.includes('bo id') ||
          lower.includes('boid') ||
          lower.includes('dp id') ||
          lower.includes('client id') ||
          lower.includes('account no') ||
          lower.includes('details of demat'))
      ) {
        currentDematAccount = boMatch[1];
      }

      // ── CRITICAL: Section headers NEVER contain an ISIN! ──
      // An ISIN line is always a holding or transaction data row.
      if (!hasIsin) {
        // ── 1. TRANSACTION SECTION DETECTION ──
        if (
          lower.includes('statement of transactions') ||
          lower.includes('transaction details') ||
          lower.includes('transactions for the period') ||
          lower.includes('transactions during the month') ||
          lower.includes('transactions during the period') ||
          lower.includes('beneficiary account transactions') ||
          lower.includes('summary of transactions')
        ) {
          if (currentMode !== CasSectionMode.TRANSACTIONS) {
            currentMode = CasSectionMode.TRANSACTIONS;
            log(`Entered TRANSACTIONS section at line ${i + 1}. Ignoring transaction rows for holdings.`);
          }
          continue;
        }

        // ── 2. HOLDINGS SECTION SWITCHES (Exits TRANSACTIONS mode!) ──
        // Note: Do NOT match 'details of demat' here, as that is a page header in both transaction and holding pages!
        if (
          lower.includes('holding statement as on') ||
          lower.includes('statement of holdings') ||
          lower.includes('holdings in demat') ||
          lower.includes('holdings for demat account') ||
          lower.includes('statement of account - demat')
        ) {
          currentMode = CasSectionMode.HOLDINGS_DEMAT;
          log(`Switched to HOLDINGS_DEMAT at line ${i + 1}`);
          continue;
        }

        // ── 3. MUTUAL FUNDS SOA SECTION SWITCH ──
        if (
          lower.includes('mutual fund units held in statement of account') ||
          lower.includes('statement of mutual fund units') ||
          lower.includes('mutual fund folios') ||
          lower.includes('statement of account - mutual fund') ||
          (lower.includes('statement of account') && lower.includes('folio'))
        ) {
          currentMode = CasSectionMode.MUTUAL_FUNDS_SOA;
          currentAmc = '';
          currentFolio = '';
          log(`Switched to MUTUAL_FUNDS_SOA at line ${i + 1}`);
          continue;
        }

        // ── 4. CATEGORY SUB-HEADERS (Only allowed outside TRANSACTIONS mode) ──
        if (currentMode !== CasSectionMode.TRANSACTIONS) {
          const isShortHeader = line.length < 65 && !/[\d,]{4,}/.test(line);

          if (
            isShortHeader &&
            (lower === 'equities' ||
              lower === 'equity shares' ||
              lower.startsWith('equities / etfs') ||
              lower.startsWith('statement of equity') ||
              /^equities\b/i.test(line))
          ) {
            currentMode = CasSectionMode.HOLDINGS_EQUITY;
            log(`Sub-mode: HOLDINGS_EQUITY at line ${i + 1}`);
            continue;
          }

          if (
            isShortHeader &&
            (lower.includes('bonds / debentures') ||
              lower.includes('corporate bonds') ||
              lower.includes('government securities') ||
              lower.includes('sovereign gold') ||
              lower.startsWith('sgb') ||
              lower.includes('other assets') ||
              lower.includes('invit / reit'))
          ) {
            currentMode = CasSectionMode.HOLDINGS_BOND_OR_OTHER;
            log(`Sub-mode: HOLDINGS_BOND_OR_OTHER at line ${i + 1}`);
            continue;
          }

          if (
            isShortHeader &&
            (lower.includes('mutual funds held in demat') ||
              lower.includes('mutual fund units in demat') ||
              lower === 'mutual funds')
          ) {
            currentMode = CasSectionMode.HOLDINGS_MUTUAL_FUND_DEMAT;
            log(`Sub-mode: HOLDINGS_MUTUAL_FUND_DEMAT at line ${i + 1}`);
            continue;
          }
        }

        // Track AMC and Folio for Mutual Fund SOA sections
        if (currentMode === CasSectionMode.MUTUAL_FUNDS_SOA) {
          const amcMatch = line.match(/^([A-Za-z0-9\s&.,-]+(?:MUTUAL FUND|ASSET MANAGEMENT|INVESTMENT MANAGEMENT))/i);
          if (amcMatch && !line.includes('ISIN') && !line.includes('Units') && !line.includes('NAV')) {
            currentAmc = amcMatch[1].trim();
          }

          const folioMatch = line.match(/(?:Folio\s*(?:No\.?)?|Account\s*No\.?)\s*[:.-]?\s*([A-Za-z0-9/\s-]+)/i);
          if (folioMatch) {
            const rawFolio = folioMatch[1].trim().split(/\s+/)[0];
            if (rawFolio && rawFolio.length >= 3) {
              currentFolio = rawFolio;
            }
          }
        }

        // Skip header lines
        if (this.isMetaOrHeader(line)) {
          continue;
        }
      }

      // If we are currently inside transaction history, skip line completely!
      if (currentMode === CasSectionMode.TRANSACTIONS) {
        continue;
      }

      // ── 5. DETECT ISIN LINE & PARSE HOLDING ──
      const isinMatch = line.match(ISIN_REGEX);
      if (isinMatch) {
        const isin = isinMatch[1];
        this.processHoldingLine(
          line,
          isin,
          currentMode,
          currentAmc,
          currentFolio,
          currentDematAccount,
          equities,
          dematMutualFunds,
          soaMutualFunds,
          otherAssets,
          unparsedHoldings,
          log
        );
      }
    }
  }

  /**
   * Process a single line containing an ISIN, resolving instrument type and numbers
   */
  private processHoldingLine(
    line: string,
    isin: string,
    sectionMode: CasSectionMode,
    currentAmc: string,
    currentFolio: string,
    currentDematAccount: string,
    equities: CasEquityHolding[],
    dematMutualFunds: CasMutualFundHolding[],
    soaMutualFunds: CasMutualFundHolding[],
    otherAssets: CasOtherHolding[],
    unparsedHoldings: CasUnparsedRow[],
    _log: (m: string) => void
  ) {
    const isMfIsin = isin.startsWith('INF');
    const isSoaSection = sectionMode === CasSectionMode.MUTUAL_FUNDS_SOA;

    // Check for Fixed Income / SGB / InvIT / REIT
    const isSgb =
      isin.startsWith('IN00') ||
      /\b(?:SGB|SOVEREIGN GOLD)\b/i.test(line);

    const isInvIt =
      /\b(?:INVIT|INFRASTRUCTURE INVESTMENT TRUST)\b/i.test(line);

    const isReit =
      /\b(?:REIT|REAL ESTATE INVESTMENT TRUST)\b/i.test(line);

    const isGovtSec =
      /\b(?:GOI|G-SEC|GSEC|DATED GS|TREASURY|SDL)\b/i.test(line);

    const isDebtBond =
      !isMfIsin &&
      !isSgb &&
      !isInvIt &&
      !isReit &&
      !isGovtSec &&
      (sectionMode === CasSectionMode.HOLDINGS_BOND_OR_OTHER ||
        /\b(?:BOND|BONDS|NCD|DEBENTURE|DEBENTURES|PERPETUAL|COMMERCIAL PAPER)\b/i.test(line));

    const isOtherAsset = isSgb || isInvIt || isReit || isGovtSec || isDebtBond;

    // Clean security name
    const cleanName = this.extractSecurityName(line, isin);

    // ── CASE 1: SOA MUTUAL FUND HOLDING ──
    if (isSoaSection) {
      const soaMetrics = this.solveSoaRowNumbers(line, isin);
      if (!soaMetrics || (soaMetrics.units <= 0 && soaMetrics.marketValue <= 0)) {
        unparsedHoldings.push({
          line,
          isin,
          section: 'MUTUAL_FUNDS_SOA',
          reason: 'Failed to extract valid Units or Market Value in SOA table',
        });
        return;
      }

      const isDirect = cleanName.toUpperCase().includes('DIRECT');
      const isRegular = cleanName.toUpperCase().includes('REGULAR');

      soaMutualFunds.push({
        holdingLocation: 'SOA',
        amc: currentAmc || 'Mutual Fund',
        folio: currentFolio || 'N/A',
        schemeName: cleanName || 'Mutual Fund Scheme',
        isin,
        units: soaMetrics.units,
        nav: soaMetrics.nav,
        costValue: soaMetrics.costValue,
        marketValue: soaMetrics.marketValue,
        planType: isDirect ? 'Direct' : isRegular ? 'Regular' : 'Unknown',
      });
      return;
    }

    // ── CASE 2: DEMAT MUTUAL FUND HOLDING ──
    if (isMfIsin || sectionMode === CasSectionMode.HOLDINGS_MUTUAL_FUND_DEMAT) {
      const dematMetrics = this.reconcileRowNumbers(line, isin);
      if (dematMetrics.quantity <= 0 && dematMetrics.totalValue <= 0) {
        unparsedHoldings.push({
          line,
          isin,
          section: 'HOLDINGS_MUTUAL_FUND_DEMAT',
          reason: 'Failed to extract valid Demat MF Units or Market Value',
        });
        return;
      }

      const isDirect = cleanName.toUpperCase().includes('DIRECT');
      const isRegular = cleanName.toUpperCase().includes('REGULAR');

      const detectedAmc = this.detectAmcFromName(cleanName);
      dematMutualFunds.push({
        holdingLocation: 'DEMAT',
        dematAccount: currentDematAccount || undefined,
        amc: currentAmc && currentAmc !== 'Mutual Fund' ? currentAmc : detectedAmc,
        folio: currentDematAccount || 'DEMAT',
        schemeName: cleanName || 'Mutual Fund Scheme',
        isin,
        units: dematMetrics.quantity,
        nav: dematMetrics.price,
        costValue: dematMetrics.costValue,
        marketValue: dematMetrics.totalValue || dematMetrics.quantity * dematMetrics.price,
        planType: isDirect ? 'Direct' : isRegular ? 'Regular' : 'Unknown',
      });
      return;
    }

    // ── CASE 3: OTHER ASSETS (SGB, InvIT, REIT, Bonds, G-Sec) ──
    if (isOtherAsset) {
      const metrics = this.reconcileRowNumbers(line, isin);
      if (metrics.quantity <= 0 && metrics.totalValue <= 0) {
        unparsedHoldings.push({
          line,
          isin,
          section: 'HOLDINGS_OTHER',
          reason: 'Failed to extract valid metrics for Other Asset / Bond',
        });
        return;
      }

      const assetSubtype = isSgb
        ? 'SGB'
        : isInvIt
        ? 'InvIT'
        : isReit
        ? 'REIT'
        : isGovtSec
        ? 'G-Sec'
        : 'Bond';

      otherAssets.push({
        isin,
        securityName: cleanName || isin,
        dematAccount: currentDematAccount || undefined,
        quantity: metrics.quantity,
        marketPrice: metrics.price,
        totalValue: metrics.totalValue || metrics.quantity * metrics.price,
        assetSubtype,
      });
      return;
    }

    // ── CASE 4: DEMAT EQUITIES & ETFS ──
    const metrics = this.reconcileRowNumbers(line, isin);
    if (metrics.quantity <= 0 && metrics.totalValue <= 0) {
      unparsedHoldings.push({
        line,
        isin,
        section: 'HOLDINGS_EQUITY',
        reason: 'Failed to extract valid Equity Quantity or Market Value',
      });
      return;
    }

    const isEtf = cleanName.toUpperCase().includes('ETF') || cleanName.toUpperCase().includes('BEES');
    const mappedTicker = this.tickerRegistry.lookupIsin(isin) || '';
    const cleanSym = mappedTicker.replace(/\.(NS|BO)$/, '') || isin;

    equities.push({
      isin,
      companyName: cleanName || cleanSym,
      symbol: cleanSym,
      dematAccount: currentDematAccount || undefined,
      quantity: metrics.quantity,
      marketPrice: metrics.price,
      totalValue: metrics.totalValue || metrics.quantity * metrics.price,
      holdingType: isEtf ? 'ETF' : 'Equity',
    });
  }

  /**
   * SOA Mutual Fund row parser:
   * Recognizes that the valuation column is followed by expense-ratio, commission, and profit/loss.
   * Finds the exact (Units, NAV, MarketValue) triple from the numbers.
   */
  private solveSoaRowNumbers(
    line: string,
    isin: string
  ): { units: number; nav: number; marketValue: number; costValue?: number } | null {
    const clean = this.cleanLineForNumericExtraction(line, isin);
    const nums = this.extractAllNumbers(clean);

    if (nums.length < 2) return null;

    // Scan for triple (Q, P, V) where Q * P ≈ V
    for (let vIdx = 1; vIdx < nums.length; vIdx++) {
      const V = nums[vIdx];
      if (V <= 0) continue;

      for (let i = 0; i < vIdx; i++) {
        for (let j = 0; j < vIdx; j++) {
          if (i === j) continue;
          const Q = nums[i];
          const P = nums[j];
          if (Q <= 0 || P <= 0) continue;

          const prod = Q * P;
          const diff = Math.abs(prod - V);
          const tolerance = Math.max(1.5, 0.03 * V);

          if (diff <= tolerance) {
            let units = Q;
            let nav = P;

            // In Indian Mutual Funds, NAV is typically between 5 and 5,000 INR
            if (P > 5000 && Q <= 5000) {
              units = P;
              nav = Q;
            }

            // Optional cost value immediately following Market Value
            let costVal: number | undefined;
            if (vIdx + 1 < nums.length && nums[vIdx + 1] > 0) {
              const candCost = nums[vIdx + 1];
              if (candCost > 50 && candCost < V * 10) {
                costVal = candCost;
              }
            }

            return {
              units: Math.round(units * 1000) / 1000,
              nav: Math.round(nav * 10000) / 10000,
              marketValue: Math.round(V * 100) / 100,
              costValue: costVal,
            };
          }
        }
      }
    }

    // Fallback: If 3 or more numbers, first is Units, second is NAV, third is Market Value
    if (nums.length >= 3 && nums[0] > 0 && nums[1] > 0) {
      return {
        units: Math.round(nums[0] * 1000) / 1000,
        nav: nums[1],
        marketValue: nums[2],
        costValue: nums.length >= 4 ? nums[3] : undefined,
      };
    }

    return null;
  }

  /**
   * Reconcile numbers mathematically: Quantity * Price ≈ Total Value
   * Eliminates picking up 0.000 (Pledge/Locked balance) as quantity
   */
  private reconcileRowNumbers(
    line: string,
    isin: string
  ): {
    quantity: number;
    price: number;
    totalValue: number;
    costValue?: number;
  } {
    const clean = this.cleanLineForNumericExtraction(line, isin);
    // Filter out BOIDs or numbers >= 10,000,000 (1 crore units)
    const nums = this.extractAllNumbers(clean).filter((n) => Math.abs(n) < 10000000);

    if (nums.length === 0) {
      return { quantity: 0, price: 0, totalValue: 0 };
    }

    // Try mathematical product matching: Q * P ≈ V
    const best = this.findBestQPV(nums);
    if (best) {
      return best;
    }

    // Fallback: If 3 or more numbers, last is Valuation, 2nd last is Price,
    // and quantity is the first positive balance column
    if (nums.length >= 3) {
      const totalValue = nums[nums.length - 1];
      const price = nums[nums.length - 2];
      const positiveBalances = nums.slice(0, nums.length - 2).filter((n) => n > 0 && n < 10000000);
      const quantity = positiveBalances.length > 0 ? positiveBalances[0] : price > 0 ? totalValue / price : 0;

      return {
        quantity: Math.round(quantity * 1000) / 1000,
        price,
        totalValue,
      };
    } else if (nums.length === 2) {
      const n1 = nums[0];
      const n2 = nums[1];
      if (n1 > 0 && n2 > 0) {
        if (n1 <= n2) {
          return { quantity: n1, price: n1 > 0 ? n2 / n1 : 0, totalValue: n2 };
        } else {
          return { quantity: n2, price: n2 > 0 ? n1 / n2 : 0, totalValue: n1 };
        }
      }
    } else if (nums.length === 1 && nums[0] < 10000000) {
      return { quantity: nums[0], price: 0, totalValue: 0 };
    }

    return { quantity: 0, price: 0, totalValue: 0 };
  }

  /**
   * Search for (Q, P, V) such that Q * P ≈ V with 3% tolerance
   */
  private findBestQPV(
    nums: number[]
  ): {
    quantity: number;
    price: number;
    totalValue: number;
    costValue?: number;
  } | null {
    if (nums.length < 2) return null;

    const candidateVIndices = [nums.length - 1];
    if (nums.length >= 4) {
      candidateVIndices.push(nums.length - 2);
    }

    let bestDiff = Infinity;
    let bestResult: { quantity: number; price: number; totalValue: number; costValue?: number } | null = null;

    for (const vIdx of candidateVIndices) {
      const V = nums[vIdx];
      if (V <= 0) continue;

      const pool = nums.filter((_, idx) => idx !== vIdx && _ < 10000000);

      for (let i = 0; i < pool.length; i++) {
        for (let j = 0; j < pool.length; j++) {
          if (i === j) continue;
          const Q = pool[i];
          const P = pool[j];
          if (Q <= 0 || P <= 0) continue;

          const product = Q * P;
          const diff = Math.abs(product - V);
          const tolerance = Math.max(1.5, 0.03 * V);

          if (diff <= tolerance && diff < bestDiff) {
            bestDiff = diff;
            let costVal: number | undefined;
            if (vIdx === nums.length - 2 && nums[nums.length - 1] > 0) {
              costVal = nums[nums.length - 1];
            }

            bestResult = {
              quantity: Math.round(Q * 1000) / 1000,
              price: P,
              totalValue: V,
              costValue: costVal,
            };
          }
        }
      }
    }

    return bestResult;
  }

  /**
   * Pre-cleans line for numeric extraction:
   * Strips Demat BOIDs, dates, percentages, year ranges, and standalone maturity years.
   * Normalizes word-attached hyphens ("DIRECT- 1.893") and CDSL dashes ("--") so numbers
   * are cleanly separated and never parsed as negative.
   */
  private cleanLineForNumericExtraction(line: string, isin: string): string {
    return line
      .replace(isin, ' ')
      // Strip Demat BOIDs / Account numbers (e.g. 120..., 130..., IN30..., IN...)
      .replace(/\b(120\d{13}|130\d{13}|IN30\d{14}|IN\d{14})\b/g, ' ')
      // Strip dates: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY
      .replace(/\b\d{1,2}[./-](?:[A-Za-z]{3}|\d{1,2})[./-]\d{2,4}\b/g, ' ')
      // Strip percentages: e.g. 2.50%, 7.75%
      .replace(/\b\d+(?:\.\d+)?%/g, ' ')
      // Strip year ranges: e.g. 2028-29, 2021-22
      .replace(/\b20\d\d[-/]\d\d\b/g, ' ')
      // Strip standalone maturity years: e.g. SGB 2028
      .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
      // Normalize hyphens attached to words so 'DIRECT- 1.893' doesn't turn into negative '-1.893'
      .replace(/(?<=[A-Za-z])-(?=\s|\d)/g, ' ')
      // Normalize CDSL empty balance dashes '--' into spaces
      .replace(/--+/g, ' ')
      // Normalize standalone dashes
      .replace(/(?:^|\s)-+(?=\s|$)/g, ' ');
  }

  /**
   * Clean security name by removing ISIN, index, leading BOIDs, and trailing balance dashes/numbers
   */
  private extractSecurityName(line: string, isin: string): string {
    let name = line.replace(isin, ' ').trim();
    // Strip Demat BOIDs
    name = name.replace(/\b(120\d{13}|130\d{13}|IN30\d{14}|IN\d{14})\b/g, ' ').trim();
    // Remove leading line number (e.g., "1 ", "2. ")
    name = name.replace(/^(\d+\.?|\*+|\s+)+/, '').trim();

    // Iteratively strip trailing numbers, currency symbols, and dashes from the right
    let prev = '';
    while (name !== prev) {
      prev = name;
      name = name.replace(/[-]{2,}\s*$/g, '').trim();
      name = name.replace(/(?:^|\s)-{1,3}\s*$/g, '').trim();
      name = name.replace(/[\d,]+(?:\.\d+)?\s*$/g, '').trim();
    }

    // Clean trailing hyphens or punctuation
    name = name.replace(/[-–—/,\s]+$/, '').trim();
    return name;
  }

  /**
   * Helper to detect standard Indian AMC names from scheme description
   */
  private detectAmcFromName(name: string): string {
    const u = name.toUpperCase();
    if (u.includes('HDFC')) return 'HDFC Mutual Fund';
    if (u.includes('ICICI')) return 'ICICI Prudential Mutual Fund';
    if (u.includes('NAVI')) return 'Navi Mutual Fund';
    if (u.includes('PARAG PARIKH') || u.includes('PPFAS')) return 'PPFAS Mutual Fund';
    if (u.includes('NIPPON')) return 'Nippon India Mutual Fund';
    if (u.includes('SBI')) return 'SBI Mutual Fund';
    if (u.includes('AXIS')) return 'Axis Mutual Fund';
    if (u.includes('KOTAK')) return 'Kotak Mahindra Mutual Fund';
    if (u.includes('UTI')) return 'UTI Mutual Fund';
    if (u.includes('TATA')) return 'Tata Mutual Fund';
    if (u.includes('MIRAE')) return 'Mirae Asset Mutual Fund';
    if (u.includes('QUANT')) return 'Quant Mutual Fund';
    if (u.includes('MOTILAL')) return 'Motilal Oswal Mutual Fund';
    if (u.includes('DSP')) return 'DSP Mutual Fund';
    if (u.includes('BANDHAN') || u.includes('IDFC')) return 'Bandhan Mutual Fund';
    if (u.includes('ADITYA BIRLA') || u.includes('ABSL')) return 'Aditya Birla Sun Life Mutual Fund';
    if (u.includes('EDELWEISS')) return 'Edelweiss Mutual Fund';
    if (u.includes('FRANKLIN')) return 'Franklin Templeton Mutual Fund';
    if (u.includes('SUNDARAM')) return 'Sundaram Mutual Fund';
    if (u.includes('CANARA ROBECO')) return 'Canara Robeco Mutual Fund';
    if (u.includes('HSBC')) return 'HSBC Mutual Fund';
    if (u.includes('INVESCO')) return 'Invesco Mutual Fund';
    return 'Mutual Fund';
  }

  /**
   * Extract all numbers from a string
   */
  private extractAllNumbers(str: string): number[] {
    const matches = str.match(/-?[\d,]+(?:\.\d+)?/g) || [];
    return matches
      .map((m) => parseFloat(m.replace(/,/g, '')))
      .filter((n) => !isNaN(n));
  }

  /**
   * Checks if line is a page header, page number, or table header
   */
  private isMetaOrHeader(line: string): boolean {
    const u = line.toUpperCase();
    return (
      u.startsWith('PAGE ') ||
      u.startsWith('TOTAL ') ||
      u.startsWith('SUB TOTAL') ||
      u.startsWith('SUBTOTAL') ||
      u.startsWith('CENTRAL DEPOSITORY') ||
      u.startsWith('NATIONAL SECURITIES') ||
      u.includes('ISIN DESCRIPTION') ||
      u.includes('CLOSING BALANCE') ||
      u.includes('MARKET PRICE') ||
      u.includes('DISCLAIMER')
    );
  }

  /**
   * Deduplicate and normalize Equities list
   */
  private normalizeEquities(equities: CasEquityHolding[], log: (m: string) => void): CasEquityHolding[] {
    const map = new Map<string, CasEquityHolding>();

    for (const eq of equities) {
      const key = `${eq.dematAccount || 'DEFAULT'}_${eq.isin}`.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        if (Math.abs(existing.quantity - eq.quantity) < 0.001) {
          if (eq.totalValue > existing.totalValue) {
            map.set(key, { ...eq });
          }
          continue;
        }
        const totalQty = existing.quantity + eq.quantity;
        const totalVal = existing.totalValue + eq.totalValue;
        existing.quantity = Math.round(totalQty * 1000) / 1000;
        existing.totalValue = Math.round(totalVal * 100) / 100;
        existing.marketPrice = totalQty > 0 ? existing.totalValue / totalQty : existing.marketPrice;
      } else {
        map.set(key, { ...eq });
      }
    }

    const res = Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
    log(`Normalized equities: ${res.length} distinct holdings`);
    return res;
  }

  /**
   * Deduplicate and normalize Mutual Funds list:
   * Keeps Demat holdings and SOA folios strictly independent!
   * - Demat key: DEMAT_{dematAccount}_{isin}
   * - SOA key: SOA_{amc}_{folio}_{isin}
   */
  private normalizeMutualFunds(mfs: CasMutualFundHolding[], log: (m: string) => void): CasMutualFundHolding[] {
    const map = new Map<string, CasMutualFundHolding>();

    for (const mf of mfs) {
      const key =
        mf.holdingLocation === 'DEMAT'
          ? `DEMAT_${mf.dematAccount || 'DEFAULT'}_${mf.isin}`.toUpperCase()
          : `SOA_${mf.amc || ''}_${mf.folio || 'DEFAULT'}_${mf.isin}`.toUpperCase();

      const existing = map.get(key);
      if (existing) {
        if (mf.holdingLocation === 'DEMAT') {
          // If closing balance units are identical, this is a repeated row (e.g. across page breaks).
          // Do not double-count identical closing balances.
          if (Math.abs(existing.units - mf.units) < 0.001 || existing.units <= 0 || mf.units <= 0) {
            if (mf.marketValue > 0 && mf.nav > 0) {
              map.set(key, { ...mf });
            }
            continue;
          }
        }
        existing.units = Math.round((existing.units + mf.units) * 1000) / 1000;
        existing.marketValue = Math.round((existing.marketValue + mf.marketValue) * 100) / 100;
        if (mf.costValue && existing.costValue) {
          existing.costValue += mf.costValue;
        }
      } else {
        map.set(key, { ...mf });
      }
    }

    const res = Array.from(map.values()).sort((a, b) => b.marketValue - a.marketValue);
    log(`Normalized mutual funds: ${res.length} distinct records`);
    return res;
  }

  /**
   * Normalize Other Assets (SGBs, InvITs, REITs, Bonds)
   */
  private normalizeOtherAssets(bonds: CasOtherHolding[], log: (m: string) => void): CasOtherHolding[] {
    const map = new Map<string, CasOtherHolding>();
    for (const b of bonds) {
      const key = `${b.dematAccount || 'DEFAULT'}_${b.isin}`.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        existing.quantity += b.quantity;
        existing.totalValue = Math.round((existing.totalValue + b.totalValue) * 100) / 100;
      } else {
        map.set(key, { ...b });
      }
    }
    const res = Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
    log(`Normalized other assets (SGB, InvIT, Bonds): ${res.length} distinct holdings`);
    return res;
  }

  /**
   * Read file as ArrayBuffer
   */
  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsArrayBuffer(file);
    });
  }
}
