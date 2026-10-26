import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import {
  Loan,
  AmortizationScheduleEntry,
  LoanSummaryMetrics,
  EmiPrepayment,
  FoirMetrics,
  TaxDeductionSummary,
  TaxRegime,
  PayoffStrategyItem,
  MonthlyTimelineItem,
} from '../models/emi.models';

const STORAGE_KEY = 'finance_tracker_emi_loans_v1';

@Injectable({
  providedIn: 'root',
})
export class EmiService {
  private firestore = inject(Firestore, { optional: true });
  private auth = inject(Auth, { optional: true });

  readonly loans = signal<Loan[]>([]);
  readonly loading = signal<boolean>(false);

  constructor() {
    this.loadLoans();
  }

  // ── Summary Metrics ──
  readonly summaryMetrics = computed<LoanSummaryMetrics>(() => {
    const list = this.loans();
    const active = list.filter((l) => l.status === 'Active');

    let totalMonthlyEmi = 0;
    let totalOutstandingBalance = 0;
    let totalOriginalPrincipal = 0;
    let totalInterestPayable = 0;
    let totalInterestPaid = 0;
    let totalAmountPayable = 0;
    let totalPaidSoFar = 0;

    const today = new Date();
    let closestUpcoming: {
      loanName: string;
      lender: string;
      amount: number;
      dueDateStr: string;
      daysRemaining: number;
    } | undefined;
    let minDaysRemaining = Infinity;

    for (const l of list) {
      const schedule = this.generateAmortizationSchedule(l);
      const originalTotalInterest = schedule.reduce((sum, s) => sum + s.interest, 0);
      const interestPaid = schedule.filter((s) => s.isPaid).reduce((sum, s) => sum + s.interest, 0);
      const principalPaid = schedule.filter((s) => s.isPaid).reduce((sum, s) => sum + s.principal, 0);
      const outstanding = Math.max(0, l.principalAmount - principalPaid);

      totalOriginalPrincipal += l.principalAmount;
      totalInterestPayable += originalTotalInterest;
      totalInterestPaid += interestPaid;
      totalAmountPayable += l.principalAmount + originalTotalInterest;
      totalPaidSoFar += principalPaid + interestPaid;

      if (l.status === 'Active') {
        totalMonthlyEmi += l.emiAmount;
        totalOutstandingBalance += outstanding;

        // Determine next upcoming due date
        const dueDay = Math.min(l.dueDay || 5, 28);
        const thisMonthDue = new Date(today.getFullYear(), today.getMonth(), dueDay);
        let targetDueDate = thisMonthDue;
        if (today.getDate() > dueDay) {
          targetDueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
        }
        const diffMs = targetDueDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (daysRemaining >= 0 && daysRemaining < minDaysRemaining) {
          minDaysRemaining = daysRemaining;
          closestUpcoming = {
            loanName: l.name,
            lender: l.lender,
            amount: l.emiAmount,
            dueDateStr: targetDueDate.toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }),
            daysRemaining,
          };
        }
      }
    }

    const overallProgressPct =
      totalAmountPayable > 0 ? Math.min(100, (totalPaidSoFar / totalAmountPayable) * 100) : 0;

    return {
      totalActiveLoans: active.length,
      totalMonthlyEmi: Math.round(totalMonthlyEmi),
      totalOutstandingBalance: Math.round(totalOutstandingBalance),
      totalOriginalPrincipal: Math.round(totalOriginalPrincipal),
      totalInterestPayable: Math.round(totalInterestPayable),
      totalInterestPaid: Math.round(totalInterestPaid),
      totalAmountPayable: Math.round(totalAmountPayable),
      totalPaidSoFar: Math.round(totalPaidSoFar),
      overallProgressPct: Math.round(overallProgressPct * 10) / 10,
      nextUpcomingEmi: closestUpcoming,
    };
  });

  // ── Monthly Net Income & FOIR (Debt-To-Income) ──
  readonly monthlyIncome = signal<number>(this.loadMonthlyIncome());

  private loadMonthlyIncome(): number {
    try {
      const isSet = localStorage.getItem('finance_tracker_user_income_set');
      if (isSet === 'true') {
        const saved = localStorage.getItem('finance_tracker_user_monthly_income');
        if (saved) {
          const n = parseFloat(saved);
          if (!isNaN(n) && n > 0) return n;
        }
      }
    } catch {}
    return 0; // Not configured by default
  }

  setMonthlyIncome(income: number) {
    if (income <= 0) {
      this.clearMonthlyIncome();
      return;
    }
    this.monthlyIncome.set(income);
    try {
      localStorage.setItem('finance_tracker_user_income_set', 'true');
      localStorage.setItem('finance_tracker_user_monthly_income', income.toString());
    } catch {}
  }

  clearMonthlyIncome() {
    this.monthlyIncome.set(0);
    try {
      localStorage.removeItem('finance_tracker_user_income_set');
      localStorage.removeItem('finance_tracker_user_monthly_income');
    } catch {}
  }

  readonly foirMetrics = computed<FoirMetrics>(() => {
    const income = this.monthlyIncome();
    const totalEmi = this.summaryMetrics().totalMonthlyEmi;
    const isConfigured = income > 0;

    if (!isConfigured) {
      return {
        monthlyIncome: 0,
        isConfigured: false,
        totalEmi,
        foirPct: 0,
        status: 'not_set',
        statusLabel: 'Income Not Configured',
        maxRecommendedEmi: 0,
        remainingBorrowingCapacity: 0,
      };
    }

    const foirPct = Math.round((totalEmi / income) * 1000) / 10;
    let status: 'healthy' | 'moderate' | 'risky' = 'healthy';
    let statusLabel = 'Safe & Healthy (< 35% FOIR)';
    if (foirPct > 50) {
      status = 'risky';
      statusLabel = 'High Debt Burden (> 50% FOIR)';
    } else if (foirPct >= 35) {
      status = 'moderate';
      statusLabel = 'Moderate Exposure (35 - 50% FOIR)';
    }

    const maxRecommendedEmi = Math.round(income * 0.4);
    const remainingBorrowingCapacity = Math.max(0, maxRecommendedEmi - totalEmi);

    return {
      monthlyIncome: income,
      isConfigured: true,
      totalEmi,
      foirPct,
      status,
      statusLabel,
      maxRecommendedEmi,
      remainingBorrowingCapacity,
    };
  });

  // ── Indian Income Tax Regime & Slab Configuration ──
  readonly taxRegime = signal<TaxRegime>(this.loadTaxRegime());
  readonly taxSlabRate = signal<number>(this.loadTaxSlabRate());

  private loadTaxRegime(): TaxRegime {
    try {
      const saved = localStorage.getItem('finance_tracker_tax_regime');
      if (saved === 'new' || saved === 'old') return saved;
    } catch {}
    return 'old'; // Default to old regime to showcase available deductions
  }

  setTaxRegime(regime: TaxRegime): void {
    this.taxRegime.set(regime);
    try {
      localStorage.setItem('finance_tracker_tax_regime', regime);
    } catch {}
  }

  private loadTaxSlabRate(): number {
    try {
      const saved = localStorage.getItem('finance_tracker_tax_slab_rate');
      if (saved) {
        const n = parseFloat(saved);
        if (!isNaN(n) && (n === 0.1 || n === 0.2 || n === 0.3)) return n;
      }
    } catch {}
    return 0.3; // Default 30% slab rate
  }

  setTaxSlabRate(rate: number): void {
    this.taxSlabRate.set(rate);
    try {
      localStorage.setItem('finance_tracker_tax_slab_rate', rate.toString());
    } catch {}
  }

  // ── Tax Deduction Projection (Sec 24b, 80C, 80E) ──
  readonly taxDeductionSummary = computed<TaxDeductionSummary>(() => {
    const list = this.loans().filter((l) => l.status === 'Active');
    const regime = this.taxRegime();
    const slabRate = this.taxSlabRate();

    let sec24bInterestRaw = 0;
    let sec80cPrincipalRaw = 0;
    let sec80eInterestRaw = 0;
    let eligibleLoansCount = 0;

    for (const l of list) {
      if (l.loanType === 'Home') {
        eligibleLoansCount++;
        const schedule = this.generateAmortizationSchedule(l);
        const next12 = schedule.filter((s) => !s.isPaid).slice(0, 12);
        sec24bInterestRaw += next12.reduce((acc, s) => acc + s.interest, 0);
        sec80cPrincipalRaw += next12.reduce((acc, s) => acc + s.principal, 0);
      } else if (l.loanType === 'Education') {
        eligibleLoansCount++;
        const schedule = this.generateAmortizationSchedule(l);
        const next12 = schedule.filter((s) => !s.isPaid).slice(0, 12);
        sec80eInterestRaw += next12.reduce((acc, s) => acc + s.interest, 0);
      }
    }

    // Potential Old Regime Deductions
    const potential24b = Math.min(200000, Math.round(sec24bInterestRaw));
    const potential80c = Math.min(150000, Math.round(sec80cPrincipalRaw));
    const potential80e = Math.round(sec80eInterestRaw);
    const potentialOldRegimeDeduction = potential24b + potential80c + potential80e;
    const potentialOldRegimeTaxSaved = Math.round(potentialOldRegimeDeduction * slabRate);

    // If New Tax Regime (Section 115BAC), deductions under 24b (self-occupied), 80C, and 80E are ₹0
    const isOld = regime === 'old';
    const sec24bInterest = isOld ? potential24b : 0;
    const sec80cPrincipal = isOld ? potential80c : 0;
    const sec80eInterest = isOld ? potential80e : 0;
    const totalEligibleDeduction = isOld ? potentialOldRegimeDeduction : 0;
    const estimatedTaxSaved = isOld ? potentialOldRegimeTaxSaved : 0;

    return {
      regime,
      taxSlabRate: slabRate,
      sec24bInterest,
      sec80cPrincipal,
      sec80eInterest,
      totalEligibleDeduction,
      estimatedTaxSaved,
      potentialOldRegimeDeduction,
      potentialOldRegimeTaxSaved,
      eligibleLoansCount,
    };
  });

  // ── Monthly Payment Timeline Schedule ──
  readonly monthlyTimeline = computed<MonthlyTimelineItem[]>(() => {
    const list = this.loans().filter((l) => l.status === 'Active');
    const today = new Date();
    const currentMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const currentDay = today.getDate();

    const items: MonthlyTimelineItem[] = list.map((l) => {
      const dueDay = Math.min(l.dueDay || 5, 28);
      const isPaidThisMonth = !!(l.lastPaymentDate && l.lastPaymentDate.startsWith(currentMonthPrefix));

      let status: 'paid' | 'due_today' | 'due_soon' | 'upcoming' | 'overdue' = 'upcoming';
      let daysRemaining = 0;
      let targetDueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);

      if (isPaidThisMonth) {
        status = 'paid';
        targetDueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
        daysRemaining = Math.max(0, Math.ceil((targetDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      } else if (currentDay === dueDay) {
        status = 'due_today';
        daysRemaining = 0;
      } else if (currentDay > dueDay) {
        status = 'overdue';
        daysRemaining = currentDay - dueDay;
      } else {
        daysRemaining = dueDay - currentDay;
        status = daysRemaining <= 5 ? 'due_soon' : 'upcoming';
      }

      const dueDateStr = targetDueDate.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      });

      return {
        loan: l,
        dueDay,
        dueDateStr,
        amount: l.emiAmount,
        isPaidThisMonth,
        daysRemaining,
        status,
      };
    });

    return items.sort((a, b) => a.dueDay - b.dueDay);
  });

  // ── Payoff Strategy Generator (Avalanche & Snowball) ──
  getPayoffStrategy(method: 'avalanche' | 'snowball'): PayoffStrategyItem[] {
    const active = this.loans().filter((l) => l.status === 'Active');
    const items = active.map((loan) => {
      const schedule = this.generateAmortizationSchedule(loan);
      const paid = schedule.filter((s) => s.isPaid);
      const outstanding = paid.length > 0 ? paid[paid.length - 1].endingBalance : loan.principalAmount;
      return {
        loan,
        rank: 1,
        outstandingBalance: Math.round(outstanding),
        interestRate: loan.interestRate,
        monthlyEmi: loan.emiAmount,
        strategyReason: '',
      };
    });

    if (method === 'avalanche') {
      items.sort((a, b) => b.interestRate - a.interestRate);
      items.forEach((item, idx) => {
        item.rank = idx + 1;
        item.strategyReason = idx === 0
          ? `Highest interest rate (${item.interestRate}% p.a.) — paying extra here saves the most money in interest!`
          : `Interest rate: ${item.interestRate}% p.a.`;
      });
    } else {
      items.sort((a, b) => a.outstandingBalance - b.outstandingBalance);
      items.forEach((item, idx) => {
        item.rank = idx + 1;
        item.strategyReason = idx === 0
          ? `Smallest balance (₹${item.outstandingBalance.toLocaleString('en-IN')}) — eliminate this first for immediate cash-flow freedom!`
          : `Outstanding: ₹${item.outstandingBalance.toLocaleString('en-IN')}`;
      });
    }

    return items;
  }

  // ── Mathematical EMI Calculator ──
  calculateEmi(principal: number, annualInterestRate: number, tenureMonths: number): number {
    if (principal <= 0 || tenureMonths <= 0) return 0;
    if (annualInterestRate <= 0) {
      // 0% / No-Cost EMI
      return Math.round((principal / tenureMonths) * 100) / 100;
    }
    const monthlyRate = annualInterestRate / (12 * 100);
    const compound = Math.pow(1 + monthlyRate, tenureMonths);
    const emi = (principal * monthlyRate * compound) / (compound - 1);
    return Math.round(emi * 100) / 100;
  }

  // ── Amortization Schedule Generation ──
  generateAmortizationSchedule(loan: Loan): AmortizationScheduleEntry[] {
    const schedule: AmortizationScheduleEntry[] = [];
    let balance = loan.principalAmount;
    const monthlyRate = loan.interestRate > 0 ? loan.interestRate / (12 * 100) : 0;
    const emi = loan.emiAmount;

    const startDate = loan.startDate ? new Date(loan.startDate) : new Date();

    for (let i = 1; i <= loan.tenureMonths; i++) {
      if (balance <= 0) break;

      const interest = monthlyRate > 0 ? Math.round(balance * monthlyRate * 100) / 100 : 0;
      let principal = Math.round((emi - interest) * 100) / 100;

      if (principal > balance || i === loan.tenureMonths) {
        principal = balance;
      }

      const endingBalance = Math.max(0, Math.round((balance - principal) * 100) / 100);

      const entryDate = new Date(startDate.getFullYear(), startDate.getMonth() + (i - 1), loan.dueDay || 5);
      const dateStr = entryDate.toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      });

      schedule.push({
        monthIndex: i,
        dateStr,
        beginningBalance: balance,
        emi: Math.round((principal + interest) * 100) / 100,
        principal,
        interest,
        endingBalance,
        isPaid: i <= loan.paidEmis,
      });

      balance = endingBalance;
    }

    return schedule;
  }

  // ── Prepayment Simulation ──
  simulatePrepayment(
    loan: Loan,
    extraAmount: number,
    option: 'reduce_tenure' | 'reduce_emi'
  ): {
    newEmi: number;
    newTenureMonths: number;
    interestSaved: number;
    monthsSaved: number;
  } {
    if (extraAmount <= 0) {
      return {
        newEmi: loan.emiAmount,
        newTenureMonths: loan.tenureMonths - loan.paidEmis,
        interestSaved: 0,
        monthsSaved: 0,
      };
    }

    const currentSchedule = this.generateAmortizationSchedule(loan);
    const paidSchedule = currentSchedule.filter((s) => s.isPaid);
    const currentOutstanding =
      paidSchedule.length > 0 ? paidSchedule[paidSchedule.length - 1].endingBalance : loan.principalAmount;

    const remainingOldInterest = currentSchedule.filter((s) => !s.isPaid).reduce((s, c) => s + c.interest, 0);

    const effectivePrincipal = Math.max(0, currentOutstanding - extraAmount);
    const remainingTenure = Math.max(1, loan.tenureMonths - loan.paidEmis);
    const monthlyRate = loan.interestRate / (12 * 100);

    if (option === 'reduce_emi') {
      const newEmi = this.calculateEmi(effectivePrincipal, loan.interestRate, remainingTenure);
      let newTotalInterest = 0;
      let bal = effectivePrincipal;
      for (let i = 0; i < remainingTenure; i++) {
        const int = bal * monthlyRate;
        const princ = Math.min(bal, newEmi - int);
        newTotalInterest += int;
        bal = Math.max(0, bal - princ);
      }
      return {
        newEmi,
        newTenureMonths: remainingTenure,
        interestSaved: Math.max(0, Math.round(remainingOldInterest - newTotalInterest)),
        monthsSaved: 0,
      };
    } else {
      // Reduce tenure: keep same EMI
      let bal = effectivePrincipal;
      let newMonths = 0;
      let newTotalInterest = 0;
      while (bal > 0 && newMonths < remainingTenure * 2) {
        newMonths++;
        const int = bal * monthlyRate;
        const princ = Math.min(bal, loan.emiAmount - int);
        newTotalInterest += int;
        bal = Math.max(0, bal - princ);
      }

      return {
        newEmi: loan.emiAmount,
        newTenureMonths: newMonths,
        interestSaved: Math.max(0, Math.round(remainingOldInterest - newTotalInterest)),
        monthsSaved: Math.max(0, remainingTenure - newMonths),
      };
    }
  }

  // ── CRUD Operations ──
  async addLoan(data: Omit<Loan, 'id' | 'createdAt' | 'updatedAt'>): Promise<Loan> {
    const calculatedEmi = data.emiAmount || this.calculateEmi(data.principalAmount, data.interestRate, data.tenureMonths);
    const newLoan: Loan = {
      ...data,
      id: 'loan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      emiAmount: calculatedEmi,
      paidEmis: Math.min(data.paidEmis || 0, data.tenureMonths),
      status: data.paidEmis >= data.tenureMonths ? 'Closed' : data.status || 'Active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [newLoan, ...this.loans()];
    this.saveLoans(updated);
    return newLoan;
  }

  async updateLoan(id: string, updates: Partial<Loan>): Promise<void> {
    const list = this.loans();
    const idx = list.findIndex((l) => l.id === id);
    if (idx === -1) return;

    const existing = list[idx];
    const principal = updates.principalAmount ?? existing.principalAmount;
    const rate = updates.interestRate ?? existing.interestRate;
    const tenure = updates.tenureMonths ?? existing.tenureMonths;
    const emi = updates.emiAmount ?? this.calculateEmi(principal, rate, tenure);
    const paid = updates.paidEmis ?? existing.paidEmis;

    const updatedLoan: Loan = {
      ...existing,
      ...updates,
      principalAmount: principal,
      interestRate: rate,
      tenureMonths: tenure,
      emiAmount: emi,
      paidEmis: Math.min(paid, tenure),
      status: paid >= tenure ? 'Closed' : updates.status || existing.status,
      updatedAt: new Date().toISOString(),
    };

    const newList = [...list];
    newList[idx] = updatedLoan;
    this.saveLoans(newList);
  }

  async deleteLoan(id: string): Promise<void> {
    const filtered = this.loans().filter((l) => l.id !== id);
    await this.saveLoans(filtered);

    const uid = this.auth?.currentUser?.uid;
    if (uid && this.firestore) {
      try {
        const ref = doc(this.firestore, `users/${uid}/loans/${id}`);
        await deleteDoc(ref);
      } catch (err) {
        console.warn('Could not delete loan from Firestore:', err);
      }
    }
  }

  async recordEmiPayment(id: string): Promise<void> {
    const loan = this.loans().find((l) => l.id === id);
    if (!loan) return;

    const nextPaid = loan.paidEmis + 1;
    await this.updateLoan(id, {
      paidEmis: nextPaid,
      lastPaymentDate: new Date().toISOString(),
      status: nextPaid >= loan.tenureMonths ? 'Closed' : 'Active',
    });
  }

  async forecloseLoan(id: string): Promise<void> {
    const loan = this.loans().find((l) => l.id === id);
    if (!loan) return;

    await this.updateLoan(id, {
      status: 'Foreclosed',
      paidEmis: loan.tenureMonths,
      foreclosedAt: new Date().toISOString(),
      lastPaymentDate: new Date().toISOString(),
    });
  }

  async undoEmiPayment(id: string): Promise<void> {
    const loan = this.loans().find((l) => l.id === id);
    if (!loan || loan.paidEmis <= 0) return;

    const prevPaid = loan.paidEmis - 1;
    await this.updateLoan(id, {
      paidEmis: prevPaid,
      status: 'Active',
    });
  }

  async addPrepayment(
    id: string,
    prepayment: Omit<EmiPrepayment, 'id'>
  ): Promise<void> {
    const loan = this.loans().find((l) => l.id === id);
    if (!loan) return;

    const prepayId = 'prep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const record: EmiPrepayment = {
      ...prepayment,
      id: prepayId,
    };

    const currentPrepayments = loan.prepayments || [];
    const sim = this.simulatePrepayment(loan, prepayment.amount, prepayment.type);

    const updates: Partial<Loan> = {
      prepayments: [...currentPrepayments, record],
    };

    if (prepayment.type === 'reduce_tenure') {
      updates.tenureMonths = loan.paidEmis + sim.newTenureMonths;
    } else {
      updates.emiAmount = sim.newEmi;
    }

    await this.updateLoan(id, updates);
  }

  // ── Persistence & Sample Data ──
  private async loadLoans() {
    this.loading.set(true);
    try {
      // 1. Try LocalStorage for immediate instant render
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Loan[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.loans.set(parsed);
          this.loading.set(false);
        }
      }

      // 2. If authenticated, fetch and merge with Firestore
      const uid = this.auth?.currentUser?.uid;
      if (uid && this.firestore) {
        try {
          const col = collection(this.firestore, `users/${uid}/loans`);
          const snap = await getDocs(col);
          if (!snap.empty) {
            const remoteLoans: Loan[] = [];
            snap.forEach((d) => remoteLoans.push({ id: d.id, ...(d.data() as any) }));
            if (remoteLoans.length > 0) {
              this.loans.set(remoteLoans);
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteLoans));
              } catch {}
              return;
            }
          }
        } catch (e) {
          console.warn('Firestore loan sync fallback to cache:', e);
        }
      }

      // 3. Fallback to sample data if no loans exist
      if (this.loans().length === 0) {
        this.loadSampleData();
      }
    } catch (e) {
      console.warn('Failed to read loans from storage:', e);
      if (this.loans().length === 0) {
        this.loadSampleData();
      }
    } finally {
      this.loading.set(false);
    }
  }

  loadSampleData() {
    const sampleLoans: Loan[] = [
      {
        id: 'loan_sample_home',
        name: 'HDFC Smart Home Loan',
        lender: 'HDFC Bank',
        loanType: 'Home',
        principalAmount: 4500000,
        interestRate: 8.5,
        tenureMonths: 240, // 20 years
        emiAmount: 39049,
        startDate: '2023-01-05',
        dueDay: 5,
        paidEmis: 45,
        accountNumber: 'HL-4819203918',
        status: 'Active',
        notes: 'Co-borrower with spouse. Prepayment eligible without penalty.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'loan_sample_car',
        name: 'Tata Nexon EV Car Loan',
        lender: 'State Bank of India',
        loanType: 'Vehicle',
        principalAmount: 1200000,
        interestRate: 8.75,
        tenureMonths: 60, // 5 years
        emiAmount: 24765,
        startDate: '2024-03-10',
        dueDay: 10,
        paidEmis: 31,
        accountNumber: 'AL-9018274612',
        status: 'Active',
        notes: 'Electric vehicle green concession (0.25% discount applied).',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'loan_sample_gadget',
        name: 'MacBook Pro M3 Max No-Cost EMI',
        lender: 'ICICI Bank Credit Card',
        loanType: 'Gadget',
        principalAmount: 199900,
        interestRate: 0.0,
        tenureMonths: 12,
        emiAmount: 16658,
        startDate: '2026-05-15',
        dueDay: 15,
        paidEmis: 5,
        accountNumber: 'CC-EMI-8812',
        status: 'Active',
        notes: '0% interest 12-month merchant discount offer.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    this.saveLoans(sampleLoans);
  }

  private async saveLoans(list: Loan[]) {
    this.loans.set(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save loans to localStorage:', e);
    }

    const uid = this.auth?.currentUser?.uid;
    if (uid && this.firestore) {
      try {
        for (const l of list) {
          const ref = doc(this.firestore, `users/${uid}/loans/${l.id}`);
          await setDoc(ref, l, { merge: true });
        }
      } catch (err) {
        console.warn('Could not sync loans to Firestore:', err);
      }
    }
  }

  exportJson(): string {
    return JSON.stringify(this.loans(), null, 2);
  }

  importJson(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        this.saveLoans(parsed);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  clearAllLoans() {
    this.saveLoans([]);
  }
}
