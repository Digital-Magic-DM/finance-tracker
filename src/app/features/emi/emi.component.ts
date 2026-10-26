import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmiService } from '../../services/emi.service';
import { SnackbarService } from '../../services/snackbar.service';
import {
  Loan,
  LoanCategory,
  LOAN_TYPE_CONFIG,
  AmortizationScheduleEntry,
} from '../../models/emi.models';

import { TransactionService } from '../../services/transaction.service';
import { TransactionType } from '../../models/finance.models';

@Component({
  selector: 'app-emi',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './emi.component.html',
  styleUrls: ['./emi.component.scss'],
})
export class EmiComponent {
  public emiService = inject(EmiService);
  private snackbar = inject(SnackbarService);
  private txService = inject(TransactionService);

  // ── View & Filtering State ──
  readonly activeTab = signal<'active' | 'closed' | 'all' | 'strategies' | 'calculator'>('active');
  readonly selectedCategory = signal<string>('All');
  readonly searchQuery = signal<string>('');
  readonly viewMode = signal<'cards' | 'table'>('cards');

  readonly LOAN_CONFIG = LOAN_TYPE_CONFIG;
  readonly loanCategories: LoanCategory[] = [
    'Home',
    'Vehicle',
    'Personal',
    'Education',
    'CreditCard',
    'Gadget',
    'Gold',
    'Business',
    'Other',
  ];

  // ── Modals State ──
  readonly showAddEditModal = signal<boolean>(false);
  readonly editingLoanId = signal<string | null>(null);

  readonly showAmortizationModal = signal<boolean>(false);
  readonly selectedLoanForSchedule = signal<Loan | null>(null);

  readonly showPrepaymentModal = signal<boolean>(false);
  readonly selectedLoanForPrepayment = signal<Loan | null>(null);

  readonly showEditIncomeModal = signal<boolean>(false);
  readonly incomeInput = signal<number>(this.emiService.monthlyIncome());

  // ── Debt Payoff Strategies State ──
  readonly strategyMethod = signal<'avalanche' | 'snowball'>('avalanche');
  readonly extraMonthlyPayment = signal<number>(5000);

  readonly payoffStrategyItems = computed(() => {
    return this.emiService.getPayoffStrategy(this.strategyMethod());
  });

  readonly strategySavings = computed(() => {
    const items = this.payoffStrategyItems();
    if (items.length === 0) return null;
    const topLoan = items[0].loan;
    const extra = this.extraMonthlyPayment();
    if (extra <= 0) return null;
    return this.emiService.simulatePrepayment(topLoan, extra * 12, 'reduce_tenure');
  });

  // ── Debt Category Breakdown Visual ──
  readonly categoryBreakdown = computed(() => {
    const active = this.emiService.loans().filter((l) => l.status === 'Active');
    const totalOutstanding = this.emiService.summaryMetrics().totalOutstandingBalance;
    if (totalOutstanding <= 0) return [];

    const map = new Map<LoanCategory, number>();
    for (const l of active) {
      const bal = this.getOutstandingBalance(l);
      map.set(l.loanType, (map.get(l.loanType) || 0) + bal);
    }

    return Array.from(map.entries())
      .map(([cat, amount]) => {
        const config = LOAN_TYPE_CONFIG[cat];
        const pct = Math.round((amount / totalOutstanding) * 1000) / 10;
        return {
          category: cat,
          label: config.label,
          color: config.color,
          icon: config.icon,
          amount,
          pct,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  });

  // ── Add/Edit Loan Form Model ──
  formModel = signal<{
    name: string;
    lender: string;
    loanType: LoanCategory;
    principalAmount: number;
    interestRate: number;
    tenureYears: number;
    tenureMonths: number;
    tenureUnit: 'years' | 'months';
    startDate: string;
    dueDay: number;
    paidEmis: number;
    accountNumber: string;
    notes: string;
    customEmi: number | null;
  }>({
    name: '',
    lender: '',
    loanType: 'Home',
    principalAmount: 2500000,
    interestRate: 8.5,
    tenureYears: 15,
    tenureMonths: 180,
    tenureUnit: 'years',
    startDate: new Date().toISOString().slice(0, 10),
    dueDay: 5,
    paidEmis: 0,
    accountNumber: '',
    notes: '',
    customEmi: null,
  });

  // Dynamic preview calculated for modal
  modalCalculatedEmi = computed(() => {
    const m = this.formModel();
    const months = m.tenureUnit === 'years' ? m.tenureYears * 12 : m.tenureMonths;
    if (m.customEmi && m.customEmi > 0) return m.customEmi;
    return this.emiService.calculateEmi(m.principalAmount, m.interestRate, months);
  });

  modalTotalPayable = computed(() => {
    const emi = this.modalCalculatedEmi();
    const m = this.formModel();
    const months = m.tenureUnit === 'years' ? m.tenureYears * 12 : m.tenureMonths;
    return emi * months;
  });

  modalTotalInterest = computed(() => {
    const total = this.modalTotalPayable();
    const p = this.formModel().principalAmount;
    return Math.max(0, total - p);
  });

  // ── Prepayment Form State ──
  prepayAmount = signal<number>(50000);
  prepayOption = signal<'reduce_tenure' | 'reduce_emi'>('reduce_tenure');
  prepayDate = signal<string>(new Date().toISOString().slice(0, 10));
  prepayNote = signal<string>('Part-payment from bonus');

  // Prepayment simulation preview
  prepaySimulation = computed(() => {
    const loan = this.selectedLoanForPrepayment();
    if (!loan) return null;
    return this.emiService.simulatePrepayment(loan, this.prepayAmount(), this.prepayOption());
  });

  // ── Standalone Calculator Tab State ──
  calcPrincipal = signal<number>(1000000);
  calcRate = signal<number>(8.5);
  calcTenureYears = signal<number>(5);

  calcEmi = computed(() => {
    return this.emiService.calculateEmi(
      this.calcPrincipal(),
      this.calcRate(),
      this.calcTenureYears() * 12
    );
  });

  calcTotalPayable = computed(() => {
    return this.calcEmi() * (this.calcTenureYears() * 12);
  });

  calcTotalInterest = computed(() => {
    return Math.max(0, this.calcTotalPayable() - this.calcPrincipal());
  });

  calcPrincipalSharePct = computed(() => {
    const total = this.calcTotalPayable();
    if (total <= 0) return 100;
    return Math.round((this.calcPrincipal() / total) * 100);
  });

  // ── Table Sorting State ──
  readonly sortField = signal<'name' | 'loanType' | 'lender' | 'principalAmount' | 'interestRate' | 'emiAmount' | 'progress' | 'outstanding' | 'status'>('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  toggleSort(field: 'name' | 'loanType' | 'lender' | 'principalAmount' | 'interestRate' | 'emiAmount' | 'progress' | 'outstanding' | 'status') {
    if (this.sortField() === field) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortDirection.set(field === 'principalAmount' || field === 'emiAmount' || field === 'outstanding' || field === 'progress' ? 'desc' : 'asc');
    }
  }

  getSortIcon(field: 'name' | 'loanType' | 'lender' | 'principalAmount' | 'interestRate' | 'emiAmount' | 'progress' | 'outstanding' | 'status'): string {
    if (this.sortField() !== field) return 'unfold_more';
    return this.sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  // ── Filtered Loans List ──
  readonly filteredLoans = computed<Loan[]>(() => {
    const all = this.emiService.loans();
    const tab = this.activeTab();
    const cat = this.selectedCategory();
    const q = this.searchQuery().trim().toLowerCase();

    const list = all.filter((l) => {
      // Tab filter
      if (tab === 'active' && l.status !== 'Active') return false;
      if (tab === 'closed' && l.status === 'Active') return false;

      // Category filter
      if (cat !== 'All' && l.loanType !== cat) return false;

      // Search query filter
      if (q) {
        const matchName = l.name.toLowerCase().includes(q);
        const matchLender = l.lender.toLowerCase().includes(q);
        const matchAcc = l.accountNumber?.toLowerCase().includes(q) ?? false;
        if (!matchName && !matchLender && !matchAcc) return false;
      }

      return true;
    });

    const field = this.sortField();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return list.slice().sort((a, b) => {
      let diff = 0;
      switch (field) {
        case 'name':
          diff = (a.name || '').localeCompare(b.name || '');
          break;
        case 'loanType':
          diff = (a.loanType || '').localeCompare(b.loanType || '');
          break;
        case 'lender':
          diff = (a.lender || '').localeCompare(b.lender || '');
          break;
        case 'principalAmount':
          diff = a.principalAmount - b.principalAmount;
          break;
        case 'interestRate':
          diff = a.interestRate - b.interestRate;
          break;
        case 'emiAmount':
          diff = a.emiAmount - b.emiAmount;
          break;
        case 'progress':
          diff = this.getProgressPct(a) - this.getProgressPct(b);
          break;
        case 'outstanding':
          diff = this.getOutstandingBalance(a) - this.getOutstandingBalance(b);
          break;
        case 'status':
          diff = (a.status || '').localeCompare(b.status || '');
          break;
      }
      return diff * dir;
    });
  });

  // ── Action Handlers ──
  openAddModal(prefilledCategory?: LoanCategory) {
    const cat = prefilledCategory || 'Home';
    const config = LOAN_TYPE_CONFIG[cat];
    this.editingLoanId.set(null);
    this.formModel.set({
      name: '',
      lender: '',
      loanType: cat,
      principalAmount: cat === 'Home' ? 3500000 : cat === 'Vehicle' ? 1000000 : 200000,
      interestRate: config.defaultRate,
      tenureYears: config.defaultTenureYears,
      tenureMonths: config.defaultTenureYears * 12,
      tenureUnit: 'years',
      startDate: new Date().toISOString().slice(0, 10),
      dueDay: 5,
      paidEmis: 0,
      accountNumber: '',
      notes: '',
      customEmi: null,
    });
    this.showAddEditModal.set(true);
  }

  openEditModal(loan: Loan) {
    this.editingLoanId.set(loan.id);
    const isYearsMultiple = loan.tenureMonths % 12 === 0;
    this.formModel.set({
      name: loan.name,
      lender: loan.lender,
      loanType: loan.loanType,
      principalAmount: loan.principalAmount,
      interestRate: loan.interestRate,
      tenureYears: Math.floor(loan.tenureMonths / 12) || 1,
      tenureMonths: loan.tenureMonths,
      tenureUnit: isYearsMultiple ? 'years' : 'months',
      startDate: loan.startDate || new Date().toISOString().slice(0, 10),
      dueDay: loan.dueDay || 5,
      paidEmis: loan.paidEmis || 0,
      accountNumber: loan.accountNumber || '',
      notes: loan.notes || '',
      customEmi: loan.emiAmount,
    });
    this.showAddEditModal.set(true);
  }

  async saveLoan() {
    const m = this.formModel();
    if (!m.name.trim()) {
      this.snackbar.show('Please provide a loan name or title', 'error');
      return;
    }
    if (!m.lender.trim()) {
      this.snackbar.show('Please specify the lender or bank', 'error');
      return;
    }
    if (m.principalAmount <= 0) {
      this.snackbar.show('Principal amount must be greater than zero', 'error');
      return;
    }

    const tenureMonths = m.tenureUnit === 'years' ? m.tenureYears * 12 : m.tenureMonths;
    const emi = m.customEmi && m.customEmi > 0 ? m.customEmi : this.modalCalculatedEmi();

    if (this.editingLoanId()) {
      await this.emiService.updateLoan(this.editingLoanId()!, {
        name: m.name.trim(),
        lender: m.lender.trim(),
        loanType: m.loanType,
        principalAmount: m.principalAmount,
        interestRate: m.interestRate,
        tenureMonths,
        emiAmount: emi,
        startDate: m.startDate,
        dueDay: m.dueDay,
        paidEmis: m.paidEmis,
        accountNumber: m.accountNumber.trim() || undefined,
        notes: m.notes.trim() || undefined,
      });
      this.snackbar.show(`Loan "${m.name}" updated successfully`, 'success');
    } else {
      await this.emiService.addLoan({
        name: m.name.trim(),
        lender: m.lender.trim(),
        loanType: m.loanType,
        principalAmount: m.principalAmount,
        interestRate: m.interestRate,
        tenureMonths,
        emiAmount: emi,
        startDate: m.startDate,
        dueDay: m.dueDay,
        paidEmis: m.paidEmis,
        accountNumber: m.accountNumber.trim() || undefined,
        status: m.paidEmis >= tenureMonths ? 'Closed' : 'Active',
        notes: m.notes.trim() || undefined,
      });
      this.snackbar.show(`Loan "${m.name}" added successfully`, 'success');
    }

    this.showAddEditModal.set(false);
  }

  closeAddEditModal() {
    this.showAddEditModal.set(false);
  }

  async deleteLoan(loan: Loan) {
    if (confirm(`Are you sure you want to delete "${loan.name}"? This action cannot be undone.`)) {
      await this.emiService.deleteLoan(loan.id);
      this.snackbar.show(`Loan "${loan.name}" deleted`, 'success');
    }
  }

  async recordPayment(loan: Loan) {
    await this.emiService.recordEmiPayment(loan.id);

    // Automatically connect with Transactions ledger
    try {
      await this.txService.addTransaction({
        type: TransactionType.Expense,
        amount: loan.emiAmount,
        description: `EMI Payment: ${loan.name}`,
        category: 'Debt / Loan Repayment',
        bank: loan.lender,
        date: new Date(),
        notes: `Installment #${loan.paidEmis + 1} recorded from FinTracker EMI Manager`,
      });
    } catch (e) {
      console.warn('Could not sync payment with transactions:', e);
    }

    this.snackbar.show(
      `Recorded EMI #${loan.paidEmis + 1} (₹${loan.emiAmount.toLocaleString('en-IN')}) & synced to Transactions`,
      'success'
    );
  }

  async undoPayment(loan: Loan) {
    if (loan.paidEmis > 0) {
      await this.emiService.undoEmiPayment(loan.id);
      this.snackbar.show(`Reverted last EMI payment for "${loan.name}"`, 'success');
    }
  }

  async forecloseLoan(loan: Loan) {
    const outstanding = this.getOutstandingBalance(loan);
    const confirmed = confirm(
      `Foreclose "${loan.name}"?\n\nThis will mark the loan as fully paid off with a final settlement of ₹${outstanding.toLocaleString('en-IN')}, stopping future monthly EMIs.`
    );
    if (confirmed) {
      await this.emiService.forecloseLoan(loan.id);
      this.snackbar.show(`Loan "${loan.name}" marked as Foreclosed & fully settled`, 'success');
    }
  }

  // ── FOIR Monthly Income Modal Handlers ──
  openEditIncomeModal() {
    this.incomeInput.set(this.emiService.monthlyIncome() || 100000);
    this.showEditIncomeModal.set(true);
  }

  closeEditIncomeModal() {
    this.showEditIncomeModal.set(false);
  }

  setPresetIncome(amount: number) {
    this.incomeInput.set(amount);
  }

  saveIncome() {
    const inc = this.incomeInput();
    if (inc <= 0) {
      this.clearIncome();
      return;
    }
    this.emiService.setMonthlyIncome(inc);
    this.snackbar.show(`Monthly income set to ₹${inc.toLocaleString('en-IN')}`, 'success');
    this.showEditIncomeModal.set(false);
  }

  clearIncome() {
    this.emiService.clearMonthlyIncome();
    this.incomeInput.set(0);
    this.snackbar.show('Monthly income removed. FOIR set to optional.', 'info');
    this.showEditIncomeModal.set(false);
  }

  // ── Indian Income Tax Regime & Slab Handlers ──
  setTaxRegime(regime: 'old' | 'new') {
    this.emiService.setTaxRegime(regime);
    const label = regime === 'new' ? 'New Tax Regime (Sec 115BAC)' : 'Old Tax Regime';
    this.snackbar.show(`Switched to ${label}`, 'info');
  }

  setTaxSlabRate(rate: number) {
    this.emiService.setTaxSlabRate(rate);
  }

  // ── Amortization Schedule Modal ──
  openSchedule(loan: Loan) {
    this.selectedLoanForSchedule.set(loan);
    this.showAmortizationModal.set(true);
  }

  closeSchedule() {
    this.showAmortizationModal.set(false);
    this.selectedLoanForSchedule.set(null);
  }

  getAmortizationSchedule(loan: Loan): AmortizationScheduleEntry[] {
    return this.emiService.generateAmortizationSchedule(loan);
  }

  exportScheduleCsv(loan: Loan) {
    const schedule = this.getAmortizationSchedule(loan);
    const headers = 'Month,Date,Beginning Balance,EMI,Principal,Interest,Ending Balance,Status\n';
    const rows = schedule
      .map(
        (s) =>
          `${s.monthIndex},"${s.dateStr}",${s.beginningBalance},${s.emi},${s.principal},${s.interest},${s.endingBalance},${s.isPaid ? 'Paid' : 'Upcoming'}`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Amortization_${loan.name.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.snackbar.show('Amortization schedule exported to CSV', 'success');
  }

  // ── Prepayment Modal ──
  openPrepaymentModal(loan: Loan) {
    this.selectedLoanForPrepayment.set(loan);
    this.prepayAmount.set(Math.min(100000, Math.round(loan.principalAmount * 0.1)));
    this.prepayOption.set('reduce_tenure');
    this.prepayDate.set(new Date().toISOString().slice(0, 10));
    this.prepayNote.set('Part-payment');
    this.showPrepaymentModal.set(true);
  }

  closePrepaymentModal() {
    this.showPrepaymentModal.set(false);
    this.selectedLoanForPrepayment.set(null);
  }

  async applyPrepayment() {
    const loan = this.selectedLoanForPrepayment();
    if (!loan) return;
    if (this.prepayAmount() <= 0) {
      this.snackbar.show('Prepayment amount must be greater than zero', 'error');
      return;
    }

    await this.emiService.addPrepayment(loan.id, {
      date: this.prepayDate(),
      amount: this.prepayAmount(),
      type: this.prepayOption(),
      note: this.prepayNote(),
    });

    // Automatically sync prepayment with Transactions ledger
    try {
      await this.txService.addTransaction({
        type: TransactionType.Expense,
        amount: this.prepayAmount(),
        description: `Loan Prepayment: ${loan.name}`,
        category: 'Debt / Loan Repayment',
        bank: loan.lender,
        date: new Date(this.prepayDate()),
        notes: `Part-payment (${this.prepayOption() === 'reduce_tenure' ? 'Tenure Reduction' : 'EMI Reduction'}) recorded from EMI Manager`,
      });
    } catch (e) {
      console.warn('Could not sync prepayment with transactions:', e);
    }

    this.snackbar.show(
      `Prepayment of ₹${this.prepayAmount().toLocaleString('en-IN')} applied & recorded in Transactions`,
      'success'
    );
    this.closePrepaymentModal();
  }

  // ── Metrics Helpers for Loan Cards ──
  getOutstandingBalance(loan: Loan): number {
    const schedule = this.emiService.generateAmortizationSchedule(loan);
    const paidSchedule = schedule.filter((s) => s.isPaid);
    if (paidSchedule.length === 0) return loan.principalAmount;
    return paidSchedule[paidSchedule.length - 1].endingBalance;
  }

  getPrincipalPaid(loan: Loan): number {
    return Math.max(0, loan.principalAmount - this.getOutstandingBalance(loan));
  }

  getProgressPct(loan: Loan): number {
    if (loan.principalAmount <= 0) return 0;
    return Math.min(100, Math.round((this.getPrincipalPaid(loan) / loan.principalAmount) * 100));
  }

  getTotalInterest(loan: Loan): number {
    const schedule = this.emiService.generateAmortizationSchedule(loan);
    return Math.round(schedule.reduce((sum, s) => sum + s.interest, 0));
  }

  getRemainingMonths(loan: Loan): number {
    return Math.max(0, loan.tenureMonths - loan.paidEmis);
  }

  getNextDueDateStr(loan: Loan): string {
    const dueDay = Math.min(loan.dueDay || 5, 28);
    const today = new Date();
    let target = new Date(today.getFullYear(), today.getMonth(), dueDay);
    if (today.getDate() > dueDay) {
      target = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
    }
    return target.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }


  exportDataJson() {
    const json = this.emiService.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance_tracker_emi_loans_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.snackbar.show('Loans exported to JSON', 'success');
  }
}
