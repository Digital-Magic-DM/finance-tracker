import { Injectable, inject } from '@angular/core';
import { AssetService } from './asset.service';
import { MarketCalendarService } from './market-calendar.service';
import {
  Sip,
  SipInstallment,
  ReconciliationCandidate,
} from '../models/sip.models';
import { AssetType, Transaction, TransactionType } from '../models/finance.models';
import { CasMutualFundHolding } from './cas-parser.service';

export interface ReconciliationResult {
  matchedCount: number;
  unresolvedCount: number;
  discrepancyCount: number;
  candidates: ReconciliationCandidate[];
  summaryMessage: string;
}

@Injectable({ providedIn: 'root' })
export class SipReconciliationService {
  private assetService = inject(AssetService);
  private calendar = inject(MarketCalendarService);

  /**
   * Reconcile active SIP installments against imported bank transactions.
   * Matches bank debit entries for SIP mandates.
   * NOTE: Bank debit confirms paymentStatus = 'Debited', but allotmentStatus remains 'Pending'
   * until unit allotment is verified via CAS or AMC statement!
   */
  async reconcileBankTransactions(
    sips: Sip[],
    importedTransactions: Transaction[]
  ): Promise<ReconciliationResult> {
    const candidates: ReconciliationCandidate[] = [];
    let matchedCount = 0;
    let discrepancyCount = 0;
    let unresolvedCount = 0;

    for (const sip of sips) {
      if (sip.status === 'Cancelled') continue;
      const installments = sip.installments || [];

      for (const inst of installments) {
        // Skip already fully confirmed installments
        if (inst.allotmentStatus === 'Confirmed') continue;

        const candidate = this.evaluateBankMatch(sip, inst, importedTransactions);
        candidates.push(candidate);

        if (candidate.status === 'ExactMatch' || candidate.status === 'ProbableMatch') {
          matchedCount++;
        } else if (candidate.status === 'Discrepancy') {
          discrepancyCount++;
        } else {
          unresolvedCount++;
        }
      }
    }

    return {
      matchedCount,
      unresolvedCount,
      discrepancyCount,
      candidates,
      summaryMessage: `Evaluated ${candidates.length} installment(s): ${matchedCount} matched, ${discrepancyCount} discrepancies, ${unresolvedCount} awaiting records.`,
    };
  }

  /**
   * Reconcile SIP installments against CAS mutual fund holdings / statements.
   * Since CAS statements confirm actual units allotted by the RTA (CAMS/KFintech),
   * this confirms allotmentStatus = 'Confirmed' and triggers the portfolio asset holding update.
   */
  async reconcileWithCasHoldings(
    sip: Sip,
    casHoldings: CasMutualFundHolding[]
  ): Promise<{ updatedInstallments: SipInstallment[]; unitsAllotted: number; confirmedCount: number }> {
    const installments = [...(sip.installments || [])];
    let confirmedCount = 0;
    let totalAllottedUnits = 0;

    // Match holding by ISIN or Scheme Name
    const matchingHolding = casHoldings.find((h) => {
      if (sip.isin && h.isin && sip.isin.trim().toLowerCase() === h.isin.trim().toLowerCase()) {
        return true;
      }
      if (sip.folioNumber && h.folio) {
        const cleanSipFolio = sip.folioNumber.replace(/\D/g, '');
        const cleanCasFolio = h.folio.replace(/\D/g, '');
        if (cleanSipFolio && cleanCasFolio && cleanSipFolio === cleanCasFolio) {
          return true;
        }
      }
      return this.fuzzyNameMatch(sip.name, h.schemeName);
    });

    if (!matchingHolding) {
      return { updatedInstallments: installments, unitsAllotted: 0, confirmedCount: 0 };
    }

    // Check installments awaiting allotment confirmation
    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      if (inst.allotmentStatus === 'Pending' || inst.status === 'Scheduled') {
        // If execution date has passed
        const todayStr = this.calendar.formatDate(new Date());
        if (inst.executionDate <= todayStr) {
          const nav = matchingHolding.nav || (inst.amount / (matchingHolding.units || 1));
          const units = Math.round((inst.amount / nav) * 1000) / 1000;

          installments[i] = {
            ...inst,
            paymentStatus: 'Debited',
            allotmentStatus: 'Confirmed',
            reconciliationStatus: 'Matched',
            confirmationSource: 'CAS_STATEMENT',
            allotmentDate: matchingHolding.navDate || inst.executionDate,
            nav: Math.round(nav * 1000) / 1000,
            units,
            status: 'Executed',
            executedAt: new Date().toISOString(),
            reconciliationNotes: `Confirmed via CAS Holding Statement (${matchingHolding.holdingLocation}) Folio: ${matchingHolding.folio}`,
          };

          confirmedCount++;
          totalAllottedUnits += units;

          // Update actual portfolio holdings ONLY after confirmed allotment
          await this.syncConfirmedHoldingToPortfolio(sip, inst.amount, units, nav);
        }
      }
    }

    return {
      updatedInstallments: installments,
      unitsAllotted: totalAllottedUnits,
      confirmedCount,
    };
  }

  /**
   * Manually confirm an installment allotment (e.g., from AMC SMS, Email, or Investor portal).
   * Validates NAV, calculates allotted units, records audit history, and updates the portfolio holding.
   */
  async confirmAllotmentManually(
    sip: Sip,
    installmentId: string,
    allotmentData: {
      allotmentDate: string; // YYYY-MM-DD
      nav: number;
      units: number;
      externalRef?: string;
      notes?: string;
    }
  ): Promise<SipInstallment | null> {
    const installments = sip.installments || [];
    const index = installments.findIndex((inst) => inst.id === installmentId);
    if (index === -1) return null;

    const inst = installments[index];
    const nav = allotmentData.nav;
    const units = allotmentData.units;

    // Sanity checks
    if (nav <= 0 || units <= 0) {
      throw new Error('NAV and Allotted Units must be positive values.');
    }

    const calculatedCost = Math.round(nav * units);
    const amountDiff = Math.abs(calculatedCost - inst.amount);
    // Tolerance: ₹5 or 0.5% (accounts for 0.005% stamp duty & rounding)
    const isAmountConsistent = amountDiff <= Math.max(5, inst.amount * 0.005);

    const updatedInst: SipInstallment = {
      ...inst,
      paymentStatus: 'Debited',
      allotmentStatus: 'Confirmed',
      reconciliationStatus: isAmountConsistent ? 'ManuallyConfirmed' : 'Discrepancy',
      confirmationSource: 'MANUAL_ENTRY',
      allotmentDate: allotmentData.allotmentDate,
      nav: Math.round(nav * 10000) / 10000,
      units: Math.round(units * 1000) / 1000,
      externalReference: allotmentData.externalRef || inst.externalReference,
      status: 'Executed',
      executedAt: new Date().toISOString(),
      reconciliationNotes: isAmountConsistent
        ? `Manually confirmed. ${allotmentData.notes || ''}`
        : `Manually confirmed with cost variance of ₹${amountDiff}. ${allotmentData.notes || ''}`,
    };

    // Update the portfolio holding with confirmed units
    await this.syncConfirmedHoldingToPortfolio(sip, inst.amount, updatedInst.units!, updatedInst.nav!);

    return updatedInst;
  }

  /**
   * Mark an installment payment as Failed / Reversed.
   * Cancels unit allotment and logs audit notice without affecting portfolio holdings.
   */
  markPaymentFailed(
    sip: Sip,
    installmentId: string,
    reason: string
  ): SipInstallment | null {
    const installments = sip.installments || [];
    const index = installments.findIndex((inst) => inst.id === installmentId);
    if (index === -1) return null;

    const inst = installments[index];
    return {
      ...inst,
      paymentStatus: 'Failed',
      allotmentStatus: 'Cancelled',
      reconciliationStatus: 'Discrepancy',
      status: 'Skipped',
      reconciliationNotes: `Payment failed/bounced: ${reason}`,
    };
  }

  /**
   * Core rule: ONLY confirmed allotted units are added to user's actual portfolio holdings.
   * Never called on estimated or unconfirmed installments.
   */
  private async syncConfirmedHoldingToPortfolio(
    sip: Sip,
    amountInvested: number,
    allottedUnits: number,
    confirmedNav: number
  ): Promise<void> {
    try {
      const userAssets = await this.assetService.getAssetsSnapshot();
      const todayStr = this.calendar.formatDate(new Date());

      // Match existing portfolio asset by linkedAssetId, ISIN, or exact scheme name
      const existingAsset = userAssets.find((a) => {
        if (sip.linkedAssetId && a.id === sip.linkedAssetId) return true;
        if (sip.isin && a.isin && sip.isin.trim().toLowerCase() === a.isin.trim().toLowerCase()) return true;
        return a.name.trim().toLowerCase() === sip.name.trim().toLowerCase();
      });

      if (existingAsset && existingAsset.id) {
        // Update holding using weighted average buy price
        const currentQty = existingAsset.quantity || 0;
        const currentAvgPrice = existingAsset.buyPrice || confirmedNav;
        const currentTotalInvested = currentQty * currentAvgPrice;

        const newQty = currentQty + allottedUnits;
        const newTotalInvested = currentTotalInvested + amountInvested;
        const weightedAvgBuyPrice = newQty > 0 ? Math.round((newTotalInvested / newQty) * 100) / 100 : confirmedNav;

        await this.assetService.updateAsset(existingAsset.id, {
          quantity: Math.round(newQty * 1000) / 1000,
          buyPrice: weightedAvgBuyPrice,
          currentPrice: confirmedNav,
          lastUpdatedDate: todayStr,
          navDate: todayStr,
        });

        console.log(`[SipReconciliation] Updated portfolio holding for ${sip.name}: +${allottedUnits} units.`);
      } else {
        // Create new asset in portfolio
        let assetType = AssetType.MutualFund;
        if (sip.category === 'ETF') assetType = AssetType.ETF;
        if (sip.category === 'Stock') assetType = AssetType.Stock;
        if (sip.category === 'Gold') assetType = AssetType.Gold;
        if (sip.category === 'Crypto') assetType = AssetType.Crypto;

        await this.assetService.addAsset({
          name: sip.name,
          type: assetType,
          quantity: allottedUnits,
          buyPrice: confirmedNav,
          currentPrice: confirmedNav,
          symbol: sip.schemeCode || sip.isin || '',
          isin: sip.isin,
          currency: 'INR',
          purchaseDate: new Date(),
          notes: `Created via confirmed SIP allotment in ${sip.name}. Folio: ${sip.folioNumber || 'N/A'}`,
          appSource: sip.fundHouse || 'Mutual Fund AMC',
          lastUpdatedDate: todayStr,
          navDate: todayStr,
          isLiquid: true,
        });

        console.log(`[SipReconciliation] Created new portfolio holding for ${sip.name} with ${allottedUnits} units.`);
      }
    } catch (err) {
      console.warn('[SipReconciliation] Error syncing confirmed holding to portfolio:', err);
    }
  }

  /**
   * Evaluate potential match between a scheduled installment and imported bank debit transactions.
   */
  private evaluateBankMatch(
    sip: Sip,
    inst: SipInstallment,
    transactions: Transaction[]
  ): ReconciliationCandidate {
    const candidate: ReconciliationCandidate = {
      installmentId: inst.id,
      sipId: sip.id,
      sipName: sip.name,
      installmentNumber: inst.installmentNumber,
      scheduledDate: inst.scheduledDate,
      executionDate: inst.executionDate,
      expectedAmount: inst.amount,
      currentPaymentStatus: inst.paymentStatus,
      currentAllotmentStatus: inst.allotmentStatus,
      confidenceScore: 0,
      matchReasons: [],
      discrepancies: [],
      status: 'Unmatched',
    };

    const instDate = new Date(inst.executionDate).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    // Window: -2 days to +5 days around scheduled execution date
    const minTime = instDate - 2 * dayMs;
    const maxTime = instDate + 5 * dayMs;

    for (const tx of transactions) {
      if (tx.type !== TransactionType.Expense) continue;

      const txDate = new Date(tx.date).getTime();
      if (txDate < minTime || txDate > maxTime) continue;

      const amountDiff = Math.abs(tx.amount - inst.amount);
      const isExactAmount = amountDiff === 0;
      const isStampDutyTolerance = amountDiff <= Math.max(5, inst.amount * 0.001);

      // Name / Keyword match
      const descLower = (tx.description || '').toLowerCase();
      const nameWords = sip.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const matchedWords = nameWords.filter((w) => descLower.includes(w));
      const hasSipKeyword = descLower.includes('sip') || descLower.includes('ach') || descLower.includes('nach') || descLower.includes('mandate');

      let score = 0;
      const reasons: string[] = [];

      if (isExactAmount) {
        score += 50;
        reasons.push('Exact amount match');
      } else if (isStampDutyTolerance) {
        score += 40;
        reasons.push('Amount match within stamp duty tolerance');
      }

      if (matchedWords.length > 0) {
        score += Math.min(30, matchedWords.length * 15);
        reasons.push(`Description match: ${matchedWords.join(', ')}`);
      }

      if (hasSipKeyword) {
        score += 15;
        reasons.push('SIP/NACH mandate tag in description');
      }

      if (sip.mandateAccount && tx.bank && tx.bank.toLowerCase().includes(sip.mandateAccount.toLowerCase())) {
        score += 15;
        reasons.push(`Mandate bank match: ${tx.bank}`);
      }

      if (score > candidate.confidenceScore) {
        candidate.confidenceScore = score;
        candidate.matchedTransaction = {
          id: tx.id,
          date: this.calendar.formatDate(new Date(tx.date)),
          amount: tx.amount,
          description: tx.description,
          bank: tx.bank,
          source: 'BANK_IMPORT',
        };
        candidate.matchReasons = reasons;

        if (score >= 70) {
          candidate.status = 'ExactMatch';
        } else if (score >= 40) {
          candidate.status = 'ProbableMatch';
        } else {
          candidate.status = 'Discrepancy';
          candidate.discrepancies.push('Low confidence match');
        }
      }
    }

    return candidate;
  }

  private fuzzyNameMatch(a: string, b: string): boolean {
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(/direct|regular|growth|idcw|dividend|plan|option|fund|mutual/gi, '')
        .replace(/[^a-z0-9]/g, '');

    const ca = clean(a);
    const cb = clean(b);
    return ca.includes(cb) || cb.includes(ca);
  }
}
