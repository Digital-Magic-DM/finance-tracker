import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AiService } from './ai.service';

/**
 * OpenFIGI Mapping request and response types (aligned with gadicc/openfigi & OpenFIGI v3 schema)
 */
export interface OpenFigiMappingJob {
  idType: 'ID_ISIN' | 'TICKER' | 'COMPOSITE_ID_BB_GLOBAL' | 'ID_BB_GLOBAL' | 'ID_SEDOL' | 'ID_CUSIP';
  idValue: string;
  exchCode?: string;
  currency?: string;
  marketSecDes?: string;
}

export interface OpenFigiRecord {
  figi: string;
  name: string;
  ticker: string;
  exchCode: string;
  compositeFIGI?: string | null;
  securityType?: string;
  marketSector?: string;
  securityType2?: string;
  securityDescription?: string;
}

export interface OpenFigiResult {
  data?: OpenFigiRecord[];
  error?: string;
  warning?: string;
}

export interface BondDetails {
  isin: string;
  name: string;
  subType: string;
  interestRate?: number;
  maturityDate?: string;
  symbol: string;
  ticker?: string;
  description?: string;
  marketSector?: string;
  defaultBuyPrice: number;
  defaultCurrentPrice: number;
  payoutFrequency: string;
  payoutDates: string;
}

@Injectable({
  providedIn: 'root',
})
export class BondLookupService {
  private http = inject(HttpClient);
  private aiService = inject(AiService);

  /**
   * Validate ISIN format (12 alphanumeric characters, starting with 2 letter country code)
   */
  isValidISIN(isin: string): boolean {
    if (!isin) return false;
    return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(isin.trim());
  }

  /**
   * Calculate interest credit / payout dates from maturity date and payment frequency
   */
  calculatePayoutDates(maturityDate?: string, frequency: string = 'Semi-Annual'): string {
    if (!maturityDate) return '';
    const parts = maturityDate.split('-');
    if (parts.length < 3) return '';
    const month = parseInt(parts[1], 10) - 1; // 0-indexed
    const day = parseInt(parts[2], 10);
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (frequency === 'Semi-Annual') {
      const m1 = monthsShort[month];
      const m2 = monthsShort[(month + 6) % 12];
      return `${day} ${m1} & ${day} ${m2} each year`;
    } else if (frequency === 'Annual') {
      return `${day} ${monthsShort[month]} each year`;
    } else if (frequency === 'Quarterly') {
      return `Quarterly on day ${day}`;
    } else if (frequency === 'Monthly') {
      return `Monthly on day ${day}`;
    } else if (frequency === 'Cumulative') {
      return `Lump sum at maturity (${maturityDate})`;
    }
    return '';
  }

  /**
   * Fetch bond details via OpenFIGI mapping schema, with dev proxy & AI fallback
   */
  async fetchBondDetails(isinRaw: string): Promise<BondDetails | null> {
    const isin = (isinRaw || '').trim().toUpperCase();
    if (!this.isValidISIN(isin)) {
      throw new Error(`Invalid ISIN format "${isinRaw}". An ISIN must be 12 alphanumeric characters (e.g. IN0020230085 or INE001A07SD3).`);
    }

    const payload: OpenFigiMappingJob[] = [{ idType: 'ID_ISIN', idValue: isin }];

    // Candidate endpoints: Angular dev-server proxy or direct
    const endpoints = [
      '/api/openfigi/mapping',
      'https://api.openfigi.com/v3/mapping',
    ];

    for (const url of endpoints) {
      try {
        const res = await firstValueFrom(
          this.http.post<OpenFigiResult[]>(url, payload, {
            headers: { 'Content-Type': 'application/json' },
          })
        );
        const item = res?.[0]?.data?.[0];
        if (item) {
          return this.parseOpenFigiResult(isin, item);
        }
      } catch {
        // Continue to next fallback
      }
    }

    // 2. Gemini AI Fallback (if user configured Gemini API key in settings)
    if (this.aiService.hasApiKey()) {
      try {
        const aiBond = await this.fetchWithGemini(isin);
        if (aiBond) return aiBond;
      } catch (aiErr) {
        console.warn('[BondLookupService] AI fallback failed:', aiErr);
      }
    }

    return null;
  }

  /**
   * Parse OpenFIGI data into FinTracker Bond details with smart pricing & payout dates
   */
  private parseOpenFigiResult(isin: string, item: OpenFigiRecord): BondDetails {
    const desc = item.securityDescription || item.ticker || '';
    const match = desc.match(/(\d+\.?\d*)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);

    let interestRate: number | undefined;
    let maturityDate: string | undefined;

    if (match) {
      interestRate = parseFloat(match[1]);
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      let year = parseInt(match[4], 10);
      if (year < 100) year += 2000;
      maturityDate = `${year}-${month}-${day}`;
    }

    // Determine sub-type
    const isGovt =
      item.marketSector === 'Govt' ||
      item.securityType2 === 'Govt' ||
      isin.startsWith('IN00') ||
      /IGB|GOVT|TREASURY|G-SEC/i.test(desc);

    const isSGB =
      /SGB|SOVEREIGN GOLD/i.test(desc) ||
      /SGB|SOVEREIGN GOLD/i.test(item.name || '');

    let subType = 'Corporate Bond';
    let defaultBuyPrice = 1000;
    let payoutFrequency = 'Annual';

    if (isSGB) {
      subType = 'Sovereign Gold Bond (SGB)';
      defaultBuyPrice = 6000; // Average issue/current price per gram
      payoutFrequency = 'Semi-Annual';
    } else if (isGovt) {
      subType = 'Govt Bond (G-Sec)';
      defaultBuyPrice = 100; // Standard RBI Government Security face value
      payoutFrequency = 'Semi-Annual';
    } else if (/TAX[\s-]*FREE/i.test(item.name || '') || /TAX[\s-]*FREE/i.test(desc)) {
      subType = 'Tax-Free Bond';
      defaultBuyPrice = 1000;
      payoutFrequency = 'Annual';
    }

    const payoutDates = this.calculatePayoutDates(maturityDate, payoutFrequency);

    // Format human-friendly name
    let name = item.name || '';
    if (isGovt && interestRate && maturityDate) {
      const year = maturityDate.split('-')[0];
      name = `Government of India ${interestRate}% GS ${year}`;
    } else if (interestRate && maturityDate) {
      const year = maturityDate.split('-')[0];
      name = `${this.titleCase(name)} ${interestRate}% NCD ${year}`;
    } else {
      name = this.titleCase(name);
    }

    return {
      isin,
      name,
      subType,
      interestRate,
      maturityDate,
      symbol: isin,
      ticker: item.ticker,
      description: desc,
      marketSector: item.marketSector,
      defaultBuyPrice,
      defaultCurrentPrice: defaultBuyPrice,
      payoutFrequency,
      payoutDates,
    };
  }

  private titleCase(str: string): string {
    if (!str) return '';
    return str
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .trim();
  }

  /**
   * Gemini AI Fallback lookup when OpenFIGI is blocked by CORS/network
   */
  private async fetchWithGemini(isin: string): Promise<BondDetails | null> {
    const prompt = `Return a JSON object only with financial specifications for the bond/security with ISIN "${isin}".
Format:
{
  "name": "Full bond or security name",
  "subType": "Corporate Bond" | "Govt Bond (G-Sec)" | "Sovereign Gold Bond (SGB)" | "Tax-Free Bond",
  "interestRate": 7.18,
  "maturityDate": "YYYY-MM-DD",
  "defaultBuyPrice": 100,
  "payoutFrequency": "Semi-Annual" | "Annual" | "Monthly" | "Cumulative"
}
If unknown, return {"error": "not found"}. Do not wrap in markdown quotes if possible.`;

    const raw = await this.aiService.chatWithData(prompt, {});
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed && !parsed.error && parsed.name) {
      const subType = parsed.subType || 'Corporate Bond';
      const defaultBuyPrice = parsed.defaultBuyPrice || (subType === 'Govt Bond (G-Sec)' ? 100 : 1000);
      const payoutFrequency = parsed.payoutFrequency || (subType === 'Govt Bond (G-Sec)' ? 'Semi-Annual' : 'Annual');
      const payoutDates = this.calculatePayoutDates(parsed.maturityDate, payoutFrequency);

      return {
        isin,
        name: parsed.name,
        subType,
        interestRate: parsed.interestRate ? Number(parsed.interestRate) : undefined,
        maturityDate: parsed.maturityDate,
        symbol: isin,
        defaultBuyPrice,
        defaultCurrentPrice: defaultBuyPrice,
        payoutFrequency,
        payoutDates,
      };
    }
    return null;
  }
}
