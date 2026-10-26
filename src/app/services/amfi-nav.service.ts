import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NavSnapshot } from '../models/sip.models';

const NAV_CACHE_KEY = 'dmf_amfi_nav_cache';

@Injectable({ providedIn: 'root' })
export class AmfiNavService {
  private http = inject(HttpClient);
  private MFAPI_BASE = 'https://api.mfapi.in/mf';

  // In-memory cache: keyed by `${schemeCode}_${date}`
  private navCache = new Map<string, NavSnapshot>();

  constructor() {
    this.loadNavCacheFromStorage();
  }

  /**
   * Search for mutual fund schemes using official AMFI scheme catalog / MFAPI search.
   */
  async searchSchemes(query: string): Promise<Array<{ schemeCode: string; schemeName: string; isin?: string }>> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(`${this.MFAPI_BASE}/search?q=${encodeURIComponent(query)}`)
      );

      if (!Array.isArray(results)) return [];

      return results.slice(0, 20).map((item) => ({
        schemeCode: String(item.schemeCode),
        schemeName: item.schemeName,
      }));
    } catch (err) {
      console.warn('[AmfiNavService] Scheme search failed for:', query, err);
      return [];
    }
  }

  /**
   * Retrieve official NAV for a given scheme code on or closest prior to requested date (YYYY-MM-DD).
   * Respects NAV publication schedules: NAVs for day T are typically published between 21:00 and 23:30 IST on day T.
   */
  async getNavForDate(schemeCode: string | number, requestedDateStr?: string): Promise<NavSnapshot | null> {
    const code = String(schemeCode).trim();
    if (!code) return null;

    const todayStr = this.formatDate(new Date());
    const targetDate = requestedDateStr || todayStr;
    const cacheKey = `${code}_${targetDate}`;

    // 1. Check in-memory / persistent cache
    if (this.navCache.has(cacheKey)) {
      return this.navCache.get(cacheKey)!;
    }

    // 2. Fetch full NAV history from official MFAPI mirror
    try {
      const resp: any = await firstValueFrom(this.http.get(`${this.MFAPI_BASE}/${code}`));
      if (!resp || !resp.data || !Array.isArray(resp.data)) {
        console.warn(`[AmfiNavService] Invalid NAV response for scheme ${code}`);
        return null;
      }

      const schemeName = resp.meta?.scheme_name || `Scheme ${code}`;
      const isin = resp.meta?.isin_growth || resp.meta?.isin_div_reinvestment || undefined;

      // MFAPI returns dates in format "DD-MM-YYYY" (e.g. "24-10-2026")
      // Normalize requestedDate to "DD-MM-YYYY" for comparison
      const targetParts = targetDate.split('-');
      const targetDDMMYYYY = `${targetParts[2]}-${targetParts[1]}-${targetParts[0]}`;

      // Find exact match first
      const exactMatch = resp.data.find((d: any) => d.date === targetDDMMYYYY);
      if (exactMatch && !isNaN(parseFloat(exactMatch.nav))) {
        const snapshot: NavSnapshot = {
          schemeCode: code,
          isin,
          schemeName,
          nav: parseFloat(exactMatch.nav),
          navDate: targetDate,
          fetchedAt: new Date().toISOString(),
          source: 'MFAPI',
          delayed: false,
        };
        this.saveSnapshot(cacheKey, snapshot);
        return snapshot;
      }

      // If exact date not found (e.g. requested date is today before publication or weekend/holiday)
      // Find the most recent available date prior to targetDate
      const parsedTarget = new Date(targetDate).getTime();
      let bestPrior: any = null;
      let bestPriorDiff = Infinity;

      for (const item of resp.data) {
        const itemDateStr = this.convertDDMMYYYYToISO(item.date);
        const itemTime = new Date(itemDateStr).getTime();

        if (itemTime <= parsedTarget) {
          const diff = parsedTarget - itemTime;
          if (diff < bestPriorDiff) {
            bestPriorDiff = diff;
            bestPrior = item;
          }
        }
      }

      if (bestPrior && !isNaN(parseFloat(bestPrior.nav))) {
        const actualNavDate = this.convertDDMMYYYYToISO(bestPrior.date);
        const isDelayed = actualNavDate !== targetDate;

        const snapshot: NavSnapshot = {
          schemeCode: code,
          isin,
          schemeName,
          nav: parseFloat(bestPrior.nav),
          navDate: actualNavDate,
          fetchedAt: new Date().toISOString(),
          source: 'MFAPI',
          delayed: isDelayed,
        };

        // Cache under actual date
        this.saveSnapshot(`${code}_${actualNavDate}`, snapshot);
        return snapshot;
      }

      return null;
    } catch (err) {
      console.warn(`[AmfiNavService] Failed to fetch NAV for scheme ${code}:`, err);
      return null;
    }
  }

  /**
   * Parse raw official AMFI NAV linear text file (NAVAll.txt).
   * Format: Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
   */
  parseAmfiNavAllText(rawText: string): Map<string, NavSnapshot> {
    const results = new Map<string, NavSnapshot>();
    const lines = rawText.split(/\r?\n/);

    for (const line of lines) {
      const parts = line.split(';');
      if (parts.length >= 6) {
        const schemeCode = parts[0].trim();
        const isinGrowth = parts[1].trim();
        const schemeName = parts[3].trim();
        const navVal = parseFloat(parts[4].trim());
        const dateStr = parts[5].trim(); // DD-MMM-YYYY (e.g. 24-Oct-2026)

        if (/^\d{5,7}$/.test(schemeCode) && !isNaN(navVal) && navVal > 0) {
          const isoDate = this.parseAmfiDate(dateStr);
          const snapshot: NavSnapshot = {
            schemeCode,
            isin: isinGrowth || undefined,
            schemeName,
            nav: navVal,
            navDate: isoDate,
            fetchedAt: new Date().toISOString(),
            source: 'AMFI_OFFICIAL',
            delayed: false,
          };
          results.set(schemeCode, snapshot);
          this.navCache.set(`${schemeCode}_${isoDate}`, snapshot);
        }
      }
    }

    this.persistNavCache();
    return results;
  }

  private parseAmfiDate(dateStr: string): string {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return this.formatDate(d);
    }
    return this.formatDate(new Date());
  }

  private convertDDMMYYYYToISO(dmy: string): string {
    const parts = dmy.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dmy;
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private saveSnapshot(key: string, snapshot: NavSnapshot) {
    this.navCache.set(key, snapshot);
    this.persistNavCache();
  }

  private persistNavCache() {
    try {
      const entries: Array<[string, NavSnapshot]> = Array.from(this.navCache.entries()).slice(-200);
      localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(entries));
    } catch {}
  }

  private loadNavCacheFromStorage() {
    try {
      const raw = localStorage.getItem(NAV_CACHE_KEY);
      if (raw) {
        const entries = JSON.parse(raw);
        if (Array.isArray(entries)) {
          this.navCache = new Map(entries);
        }
      }
    } catch {}
  }
}
