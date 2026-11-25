import { Injectable, signal } from '@angular/core';
import { Asset, AssetType } from '../models/finance.models';

export interface LogoFallback {
  type: 'icon' | 'monogram';
  icon?: string;
  initials?: string;
  bg: string;
  color: string;
}

@Injectable({
  providedIn: 'root'
})
export class CompanyLogoService {
  // Key -> failure tier: 0 = fresh, 1 = Parqet failed (try domain favicon), 2+ = all image sources failed (use fallback)
  private failedTiers = signal<Map<string, number>>(new Map());

  private readonly AMC_DOMAINS: Array<{ keywords: string[]; domain: string }> = [
    { keywords: ['parag parikh', 'ppfas'], domain: 'amc.ppfas.com' },
    { keywords: ['mirae asset', 'mirae'], domain: 'miraeassetmf.co.in' },
    { keywords: ['hdfc'], domain: 'hdfcfund.com' },
    { keywords: ['sbi'], domain: 'sbimf.com' },
    { keywords: ['quant'], domain: 'quantmutual.com' },
    { keywords: ['nippon'], domain: 'nipponindiamf.com' },
    { keywords: ['icici prudential', 'icici pru', 'icici'], domain: 'icicipruamc.com' },
    { keywords: ['axis'], domain: 'axismf.com' },
    { keywords: ['kotak'], domain: 'kotakmf.com' },
    { keywords: ['uti'], domain: 'utimf.com' },
    { keywords: ['tata'], domain: 'tatamutualfund.com' },
    { keywords: ['motilal'], domain: 'motilaloswalmf.com' },
    { keywords: ['dsp'], domain: 'dspim.com' },
    { keywords: ['bandhan'], domain: 'bandhanmutual.com' },
    { keywords: ['franklin'], domain: 'franklintempletonindia.com' },
    { keywords: ['aditya birla', 'absl'], domain: 'mutualfund.adityabirlacapital.com' },
    { keywords: ['canara robeco'], domain: 'canararobeco.com' },
    { keywords: ['edelweiss'], domain: 'edelweissmf.com' },
    { keywords: ['invesco'], domain: 'invescomutualfund.com' },
    { keywords: ['groww'], domain: 'groww.in' },
    { keywords: ['zerodha'], domain: 'zerodha.com' },
    { keywords: ['pgim'], domain: 'pgimindiamf.com' },
    { keywords: ['sundaram'], domain: 'sundarammutual.com' },
  ];

  private readonly COMPANY_DOMAINS: Array<{ keywords: string[]; domain: string }> = [
    { keywords: ['powergrid', 'power grid', 'pginvit'], domain: 'powergrid.in' },
    { keywords: ['embassy office', 'embassy reit'], domain: 'embassyofficeparks.com' },
    { keywords: ['mindspace'], domain: 'mindspacereit.com' },
    { keywords: ['brookfield'], domain: 'brookfieldindiareit.in' },
    { keywords: ['nexus select'], domain: 'nexusselecttrust.com' },
    { keywords: ['irfc', 'indian railway finance'], domain: 'irfc.co.in' },
    { keywords: ['cdsl', 'central depository'], domain: 'cdslindia.com' },
    { keywords: ['bse'], domain: 'bseindia.com' },
    { keywords: ['nse'], domain: 'nseindia.com' },
    { keywords: ['tcs', 'tata consultancy'], domain: 'tcs.com' },
    { keywords: ['infosys', 'infy'], domain: 'infosys.com' },
    { keywords: ['reliance', 'ril'], domain: 'ril.com' },
    { keywords: ['hdfc bank'], domain: 'hdfcbank.com' },
    { keywords: ['icici bank'], domain: 'icicibank.com' },
    { keywords: ['state bank of india', 'sbi'], domain: 'sbi.co.in' },
    { keywords: ['itc'], domain: 'itcportal.com' },
    { keywords: ['jyothy'], domain: 'jyothylabs.com' },
    { keywords: ['zomato'], domain: 'zomato.com' },
    { keywords: ['swiggy'], domain: 'swiggy.com' },
    { keywords: ['paytm', 'one97'], domain: 'paytm.com' },
    { keywords: ['wipro'], domain: 'wipro.com' },
    { keywords: ['hcl'], domain: 'hcltech.com' },
  ];

  private readonly PALETTE = [
    { bg: 'rgba(59, 130, 246, 0.16)', color: '#3b82f6' },
    { bg: 'rgba(16, 185, 129, 0.16)', color: '#10b981' },
    { bg: 'rgba(139, 92, 246, 0.16)', color: '#8b5cf6' },
    { bg: 'rgba(236, 72, 153, 0.16)', color: '#ec4899' },
    { bg: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b' },
    { bg: 'rgba(6, 182, 212, 0.16)', color: '#06b6d4' },
    { bg: 'rgba(99, 102, 241, 0.16)', color: '#6366f1' },
    { bg: 'rgba(20, 184, 166, 0.16)', color: '#14b8a6' },
  ];

  getFailureTier(key: string): number {
    return this.failedTiers().get(key) || 0;
  }

  markLogoFailed(key: string): void {
    if (!key) return;
    this.failedTiers.update(map => {
      const next = new Map(map);
      const current = next.get(key) || 0;
      next.set(key, current + 1);
      return next;
    });
  }

  private resolveIsin(asset: Partial<Asset>): string {
    const explicit = (asset.isin || '').toUpperCase().trim();
    if (explicit) return explicit;
    const sym = (asset.symbol || '').toUpperCase().trim();
    if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(sym)) return sym;
    const notesMatch = (asset.notes || '').match(/\b(IN[A-Z0-9]{9}[0-9])\b/i);
    return notesMatch ? notesMatch[1].toUpperCase() : '';
  }

  getLogoKey(asset: Partial<Asset>): string {
    return (this.resolveIsin(asset) || asset.symbol || asset.name || '').toUpperCase().trim();
  }

  getLogoUrl(asset: Partial<Asset>): string | null {
    const key = this.getLogoKey(asset);
    if (!key) return null;

    const name = (asset.name || '').toLowerCase();
    const type = asset.type;
    const isin = this.resolveIsin(asset);

    // 0. Non-market assets or Government Sovereign Gold Bonds bypass directly to styled vector fallbacks
    if (
      type === AssetType.Gold ||
      type === AssetType.FixedDeposit ||
      type === AssetType.SavingsAccount ||
      type === AssetType.Cash ||
      type === AssetType.Crypto ||
      type === AssetType.RealEstate ||
      name.includes('gold') ||
      name.includes('sgb') ||
      isin.startsWith('IN00')
    ) {
      return null;
    }

    const tier = this.getFailureTier(key);
    if (tier >= 2) {
      // Both Parqet and Domain Favicon failed
      return null;
    }

    // Tier 1 Fallback: try domain favicon
    if (tier === 1) {
      return this.getDomainFavicon(asset);
    }

    // Tier 0: Primary sources

    // 1. Mutual Fund AMC domain lookup (Google Favicon)
    if (type === AssetType.MutualFund && asset.name) {
      for (const item of this.AMC_DOMAINS) {
        if (item.keywords.some(k => name.includes(k))) {
          return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${item.domain}&size=64`;
        }
      }
    }

    // 2. ISIN lookup (primary for Indian and international equities in Parqet)
    if (isin) {
      return `https://assets.parqet.com/logos/isin/${isin}`;
    }

    // 3. US Stock ticker lookup
    if (type === AssetType.USStock || (asset.currency === 'USD' && asset.symbol)) {
      const cleanSym = (asset.symbol || '').toUpperCase().trim().replace(/[^A-Z]/g, '');
      if (cleanSym) {
        return `https://assets.parqet.com/logos/symbol/${cleanSym}`;
      }
    }

    // 4. Stock symbol lookup
    if (asset.symbol) {
      const cleanSym = asset.symbol.toUpperCase().trim().split('.')[0];
      return `https://assets.parqet.com/logos/symbol/${cleanSym}`;
    }

    // 5. Try known domain favicon before giving up
    return this.getDomainFavicon(asset);
  }

  private getDomainFavicon(asset: Partial<Asset>): string | null {
    const text = `${asset.name || ''} ${asset.symbol || ''}`.toLowerCase();
    for (const item of this.COMPANY_DOMAINS) {
      if (item.keywords.some(k => text.includes(k))) {
        return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${item.domain}&size=64`;
      }
    }
    return null;
  }

  getFallback(asset: Partial<Asset>): LogoFallback {
    const name = (asset.name || '').toLowerCase();
    const type = asset.type;
    const isin = this.resolveIsin(asset);

    // Gold / Sovereign Gold Bond
    if (type === AssetType.Gold || name.includes('gold') || name.includes('sgb') || isin.startsWith('IN00')) {
      return { type: 'icon', icon: 'monetization_on', bg: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b' };
    }

    // Fixed Deposit
    if (type === AssetType.FixedDeposit || name.includes('deposit') || name.includes('fd')) {
      return { type: 'icon', icon: 'savings', bg: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b' };
    }

    // Bond / G-Sec
    if (type === AssetType.Bond || name.includes('bond')) {
      return { type: 'icon', icon: 'receipt_long', bg: 'rgba(20, 184, 166, 0.16)', color: '#14b8a6' };
    }

    // Crypto
    if (type === AssetType.Crypto) {
      return { type: 'icon', icon: 'currency_bitcoin', bg: 'rgba(139, 92, 246, 0.16)', color: '#8b5cf6' };
    }

    // Real Estate
    if (type === AssetType.RealEstate) {
      return { type: 'icon', icon: 'home', bg: 'rgba(236, 72, 153, 0.16)', color: '#ec4899' };
    }

    // Bank / Cash
    if (type === AssetType.Cash) {
      return { type: 'icon', icon: 'payments', bg: 'rgba(16, 185, 129, 0.16)', color: '#10b981' };
    }
    if (type === AssetType.SavingsAccount) {
      return { type: 'icon', icon: 'account_balance', bg: 'rgba(59, 130, 246, 0.16)', color: '#3b82f6' };
    }

    // Default: 2-letter monogram with deterministic color
    const initials = this.getInitials(asset.name || asset.symbol || '??');
    const colorIdx = this.hashString(asset.name || asset.symbol || '') % this.PALETTE.length;
    const { bg, color } = this.PALETTE[colorIdx];

    return { type: 'monogram', initials, bg, color };
  }

  private getInitials(str: string): string {
    const clean = str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    if (!clean) return '??';
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
