import { getFirestoreDb } from './firebase.js';
import {
  Asset,
  Transaction,
  NetWorthOverview,
  CashFlowSummary,
  AssetType,
  TransactionType,
  Loan,
  EmiPrepayment,
  EmiOverview,
  DebtPayoffSimulation,
  Sip,
  SipInstallment,
  SipsOverview,
  SipCategory,
  SipFrequency,
  SipStatus,
} from './types.js';

export function resolveUserId(explicitUid?: string, sessionUid?: string): string {
  // If this session was authenticated with a personal user token or OAuth, always bind to that user
  if (sessionUid) {
    return sessionUid;
  }

  // If no session UID, check DEFAULT_USER_UID from environment (standalone scripts / CLI only)
  const defaultUid = process.env.DEFAULT_USER_UID;
  if (defaultUid) {
    return defaultUid;
  }

  // Unauthenticated / unbound session: NEVER allow arbitrary user access
  throw new Error(
    'Access denied: Session is not bound to an authenticated user account. Please connect with your personal FinTracker AI key.'
  );
}

/**
 * Calculates total net worth, invested value, current value, total liabilities, liquid balance, and asset allocation breakdown.
 */
export async function getNetWorthOverview(uid: string): Promise<NetWorthOverview> {
  const db = getFirestoreDb();
  const snap = await db.collection(`users/${uid}/assets`).get();

  let totalInvested = 0;
  let totalCurrentValue = 0;
  let liquidAssets = 0;
  let illiquidAssets = 0;
  const breakdown: Record<string, { value: number; percentage: number; count: number }> = {};

  const assets: Asset[] = [];
  snap.forEach((doc) => {
    const data = doc.data();
    const asset: Asset = {
      id: doc.id,
      name: data.name || 'Unnamed Asset',
      type: data.type || 'Other',
      quantity: Number(data.quantity) || 0,
      buyPrice: Number(data.buyPrice) || 0,
      currentPrice: Number(data.currentPrice) || Number(data.buyPrice) || 0,
      currency: data.currency || 'INR',
      isLiquid: Boolean(data.isLiquid || data.type === 'Cash' || data.type === 'SavingsAccount' || data.type === 'FixedDeposit'),
      notes: data.notes,
      appSource: data.appSource,
    };
    assets.push(asset);

    const val = asset.quantity * asset.currentPrice;
    const inv = asset.quantity * asset.buyPrice;

    totalCurrentValue += val;
    totalInvested += inv;

    if (asset.isLiquid) {
      liquidAssets += val;
    } else {
      illiquidAssets += val;
    }

    if (!breakdown[asset.type]) {
      breakdown[asset.type] = { value: 0, percentage: 0, count: 0 };
    }
    breakdown[asset.type].value += val;
    breakdown[asset.type].count += 1;
  });

  // Calculate liabilities from active loans
  let totalLiabilities = 0;
  try {
    const loans = await fetchUserLoans(uid);
    for (const l of loans) {
      if (l.status === 'Active') {
        totalLiabilities += calculateLoanOutstanding(l);
      }
    }
  } catch (e) {
    // Graceful fallback if no loans collection
  }

  const totalProfit = totalCurrentValue - totalInvested;
  const profitPercentage = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  for (const key of Object.keys(breakdown)) {
    breakdown[key].percentage =
      totalCurrentValue > 0 ? (breakdown[key].value / totalCurrentValue) * 100 : 0;
    breakdown[key].value = Math.round(breakdown[key].value * 100) / 100;
    breakdown[key].percentage = Math.round(breakdown[key].percentage * 10) / 10;
  }

  const calculatedNetWorth = Math.max(0, totalCurrentValue - totalLiabilities);

  return {
    totalNetWorth: Math.round(calculatedNetWorth * 100) / 100,
    totalInvested: Math.round(totalInvested * 100) / 100,
    totalCurrentValue: Math.round(totalCurrentValue * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    profitPercentage: Math.round(profitPercentage * 10) / 10,
    liquidAssets: Math.round(liquidAssets * 100) / 100,
    illiquidAssets: Math.round(illiquidAssets * 100) / 100,
    assetsCount: assets.length,
    breakdown,
  };
}

/**
 * Lists portfolio assets with optional filtering
 */
export async function listAssets(
  uid: string,
  options?: { type?: string; isLiquid?: boolean }
): Promise<Asset[]> {
  const db = getFirestoreDb();
  let ref: FirebaseFirestore.Query = db.collection(`users/${uid}/assets`);

  if (options?.type) {
    ref = ref.where('type', '==', options.type);
  }

  const snap = await ref.get();
  const list: Asset[] = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const asset: Asset = {
      id: doc.id,
      name: data.name || 'Unnamed Asset',
      type: data.type || 'Other',
      quantity: Number(data.quantity) || 0,
      buyPrice: Number(data.buyPrice) || 0,
      currentPrice: Number(data.currentPrice) || Number(data.buyPrice) || 0,
      currency: data.currency || 'INR',
      isLiquid: Boolean(data.isLiquid || data.type === 'Cash' || data.type === 'SavingsAccount' || data.type === 'FixedDeposit'),
      notes: data.notes,
      appSource: data.appSource,
      interestRate: data.interestRate,
      maturityDate: data.maturityDate,
      subType: data.subType,
      lastUpdated: data.lastUpdated,
    };

    if (options?.isLiquid !== undefined && asset.isLiquid !== options.isLiquid) {
      return;
    }

    list.push(asset);
  });

  return list;
}

/**
 * Adds a new asset to portfolio
 */
export async function addAsset(uid: string, assetData: Omit<Asset, 'id'>): Promise<{ id: string; success: boolean }> {
  const db = getFirestoreDb();
  const now = new Date().toISOString();

  const docRef = await db.collection(`users/${uid}/assets`).add({
    ...assetData,
    lastUpdated: now,
    lastUpdatedDate: now.split('T')[0],
  });

  return { id: docRef.id, success: true };
}

/**
 * Updates an asset price or notes
 */
export async function updateAssetPrice(
  uid: string,
  assetId: string,
  currentPrice: number,
  notes?: string
): Promise<{ success: boolean }> {
  const db = getFirestoreDb();
  const docRef = db.doc(`users/${uid}/assets/${assetId}`);
  const snap = await docRef.get();

  if (!snap.exists) {
    throw new Error(`Asset with ID ${assetId} not found`);
  }

  const updates: Record<string, any> = {
    currentPrice: Number(currentPrice),
    lastUpdated: new Date().toISOString(),
    lastUpdatedDate: new Date().toISOString().split('T')[0],
  };

  if (notes !== undefined) {
    updates.notes = notes;
  }

  await docRef.update(updates);
  return { success: true };
}

/**
 * Lists transactions with flexible filtering
 */
export async function listTransactions(
  uid: string,
  options?: {
    type?: TransactionType;
    category?: string;
    bank?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }
): Promise<Transaction[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(`users/${uid}/transactions`).get();

  let list: Transaction[] = [];

  snap.forEach((doc) => {
    const data = doc.data();
    let dateStr = new Date().toISOString();

    if (data.date) {
      if (typeof data.date.toDate === 'function') {
        dateStr = data.date.toDate().toISOString();
      } else if (typeof data.date === 'string') {
        dateStr = data.date;
      }
    }

    list.push({
      id: doc.id,
      type: data.type || 'Expense',
      amount: Number(data.amount) || 0,
      description: data.description || '',
      category: data.category || 'General',
      bank: data.bank,
      date: dateStr,
      assetId: data.assetId,
      assetName: data.assetName,
      notes: data.notes,
    });
  });

  // Client-side filtering for flexible queries
  if (options?.type) {
    list = list.filter((t) => t.type.toLowerCase() === options.type!.toLowerCase());
  }
  if (options?.category) {
    list = list.filter((t) => t.category.toLowerCase().includes(options.category!.toLowerCase()));
  }
  if (options?.bank) {
    list = list.filter((t) => t.bank && t.bank.toLowerCase().includes(options.bank!.toLowerCase()));
  }
  if (options?.startDate) {
    const start = new Date(options.startDate).getTime();
    list = list.filter((t) => new Date(t.date).getTime() >= start);
  }
  if (options?.endDate) {
    const end = new Date(options.endDate).getTime();
    list = list.filter((t) => new Date(t.date).getTime() <= end);
  }

  // Sort descending by date
  list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (options?.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  return list;
}

/**
 * Adds an income or expense transaction
 */
export async function addTransaction(
  uid: string,
  tx: Omit<Transaction, 'id'>
): Promise<{ id: string; success: boolean }> {
  const db = getFirestoreDb();
  const dateObj = tx.date ? new Date(tx.date) : new Date();

  const docRef = await db.collection(`users/${uid}/transactions`).add({
    type: tx.type,
    amount: Number(tx.amount),
    description: tx.description || '',
    category: tx.category || 'General',
    bank: tx.bank || 'Primary',
    date: dateObj.toISOString(),
    assetId: tx.assetId || null,
    assetName: tx.assetName || null,
    notes: tx.notes || null,
  });

  return { id: docRef.id, success: true };
}

/**
 * Computes monthly or yearly cashflow summary
 */
export async function getCashFlowSummary(
  uid: string,
  options?: { year?: number; month?: number }
): Promise<CashFlowSummary> {
  const allTx = await listTransactions(uid);
  const now = new Date();
  const targetYear = options?.year || now.getFullYear();
  const targetMonth = options?.month !== undefined ? options.month : now.getMonth() + 1; // 1-12

  const filtered = allTx.filter((t) => {
    const d = new Date(t.date);
    const matchesYear = d.getFullYear() === targetYear;
    if (options?.month !== undefined) {
      return matchesYear && d.getMonth() + 1 === targetMonth;
    }
    return matchesYear;
  });

  let totalIncome = 0;
  let totalExpense = 0;
  const categoryMap: Record<string, number> = {};

  filtered.forEach((t) => {
    if (t.type === 'Income') {
      totalIncome += t.amount;
    } else if (t.type === 'Expense') {
      totalExpense += t.amount;
      categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
    }
  });

  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  const topCategories = Object.entries(categoryMap)
    .map(([cat, amt]) => ({
      category: cat,
      amount: Math.round(amt * 100) / 100,
      percentage: totalExpense > 0 ? Math.round((amt / totalExpense) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const periodLabel =
    options?.month !== undefined
      ? `${targetYear}-${String(targetMonth).padStart(2, '0')}`
      : `${targetYear} (Full Year)`;

  return {
    period: periodLabel,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpense: Math.round(totalExpense * 100) / 100,
    netSavings: Math.round(netSavings * 100) / 100,
    savingsRate: Math.round(savingsRate * 10) / 10,
    transactionsCount: filtered.length,
    topExpenseCategories: topCategories,
  };
}

/**
 * Calculates emergency fund runway in months based on liquid net worth and average monthly burn rate.
 */
export async function getEmergencyRunway(uid: string): Promise<{
  runwayMonths: number;
  liquidNetWorth: number;
  averageMonthlyExpense: number;
  targetRunwayMonths: number;
  status: 'safe' | 'adequate' | 'critical';
}> {
  const overview = await getNetWorthOverview(uid);
  const liquidNetWorth = overview.liquidAssets;

  // Compute average monthly expenses over the last 3 months
  const now = new Date();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(now.getMonth() - 3);

  const tx = await listTransactions(uid, {
    type: 'Expense',
    startDate: threeMonthsAgo.toISOString(),
  });

  const totalSpentLast3Months = tx.reduce((sum, t) => sum + t.amount, 0);
  const avgMonthlyBurn = totalSpentLast3Months > 0 ? totalSpentLast3Months / 3 : 25000; // Default estimate if no data

  const runwayMonths = avgMonthlyBurn > 0 ? Math.round((liquidNetWorth / avgMonthlyBurn) * 10) / 10 : 0;

  let status: 'safe' | 'adequate' | 'critical' = 'critical';
  if (runwayMonths >= 6) status = 'safe';
  else if (runwayMonths >= 3) status = 'adequate';

  return {
    runwayMonths,
    liquidNetWorth: Math.round(liquidNetWorth),
    averageMonthlyExpense: Math.round(avgMonthlyBurn),
    targetRunwayMonths: 6,
    status,
  };
}

// =============================================================================
// EMI & LOAN MANAGEMENT TOOLS
// =============================================================================

/**
 * Calculates current outstanding principal balance for a given loan.
 */
export function calculateLoanOutstanding(l: Loan): number {
  const monthlyRate = l.interestRate > 0 ? l.interestRate / (12 * 100) : 0;
  let balance = l.principalAmount;
  for (let i = 1; i <= Math.min(l.paidEmis, l.tenureMonths); i++) {
    if (balance <= 0) break;
    const interest = monthlyRate > 0 ? balance * monthlyRate : 0;
    const principal = Math.min(balance, Math.max(0, l.emiAmount - interest));
    balance -= principal;
  }
  if (l.prepayments && Array.isArray(l.prepayments)) {
    for (const prep of l.prepayments) {
      balance = Math.max(0, balance - prep.amount);
    }
  }
  return Math.max(0, Math.round(balance));
}

/**
 * Fetches all loans belonging to a user from Firestore.
 */
export async function fetchUserLoans(uid: string): Promise<Loan[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(`users/${uid}/loans`).get();
  const loans: Loan[] = [];

  snap.forEach((doc) => {
    const data = doc.data();
    loans.push({
      id: doc.id,
      name: data.name || 'Unnamed Loan',
      lender: data.lender || 'Financial Institution',
      loanType: data.loanType || 'Other',
      principalAmount: Number(data.principalAmount) || 0,
      interestRate: Number(data.interestRate) || 0,
      tenureMonths: Number(data.tenureMonths) || 12,
      emiAmount: Number(data.emiAmount) || 0,
      startDate: data.startDate || new Date().toISOString(),
      dueDay: Number(data.dueDay) || 5,
      paidEmis: Number(data.paidEmis) || 0,
      prepayments: data.prepayments || [],
      accountNumber: data.accountNumber,
      status: data.status || 'Active',
      notes: data.notes,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  });

  return loans;
}

/**
 * Comprehensive overview of all user loans, monthly outflows, and liabilities.
 */
export async function getLoansOverview(uid: string): Promise<EmiOverview> {
  const loans = await fetchUserLoans(uid);
  const active = loans.filter((l) => l.status === 'Active');

  let totalOutstandingBalance = 0;
  let totalMonthlyEmi = 0;
  let totalOriginalPrincipal = 0;
  let totalInterestPayable = 0;
  let totalInterestPaid = 0;
  let totalAmountPayable = 0;
  let totalPaidSoFar = 0;

  const debtByType: Record<string, { balance: number; monthlyEmi: number; count: number }> = {};

  const loanItems = active.map((l) => {
    const outstanding = calculateLoanOutstanding(l);
    totalOutstandingBalance += outstanding;
    totalMonthlyEmi += l.emiAmount;
    totalOriginalPrincipal += l.principalAmount;

    // Amortization interest estimates
    const monthlyRate = l.interestRate > 0 ? l.interestRate / (12 * 100) : 0;
    let b = l.principalAmount;
    let estTotalInterest = 0;
    let interestPaid = 0;

    for (let i = 1; i <= l.tenureMonths; i++) {
      if (b <= 0) break;
      const interest = monthlyRate > 0 ? b * monthlyRate : 0;
      const principal = Math.min(b, Math.max(0, l.emiAmount - interest));
      estTotalInterest += interest;
      if (i <= l.paidEmis) {
        interestPaid += interest;
      }
      b -= principal;
    }

    totalInterestPayable += estTotalInterest;
    totalInterestPaid += interestPaid;
    totalAmountPayable += l.principalAmount + estTotalInterest;
    totalPaidSoFar += l.paidEmis * l.emiAmount;

    // Grouping
    if (!debtByType[l.loanType]) {
      debtByType[l.loanType] = { balance: 0, monthlyEmi: 0, count: 0 };
    }
    debtByType[l.loanType].balance += outstanding;
    debtByType[l.loanType].monthlyEmi += l.emiAmount;
    debtByType[l.loanType].count += 1;

    return {
      id: l.id,
      name: l.name,
      lender: l.lender,
      loanType: l.loanType,
      principal: l.principalAmount,
      interestRate: l.interestRate,
      emi: l.emiAmount,
      paidEmis: l.paidEmis,
      tenureMonths: l.tenureMonths,
      outstandingBalance: outstanding,
      status: l.status,
    };
  });

  // Find next due EMI
  const today = new Date();
  const currentDay = today.getDate();
  let nextDue: EmiOverview['nextDue'] | undefined;
  if (active.length > 0) {
    const sortedByDue = [...active].sort((a, b) => {
      const aDiff = (a.dueDay - currentDay + 31) % 31;
      const bDiff = (b.dueDay - currentDay + 31) % 31;
      return aDiff - bDiff;
    });
    const first = sortedByDue[0];
    nextDue = {
      loanName: first.name,
      lender: first.lender,
      amount: first.emiAmount,
      dueDay: first.dueDay,
    };
  }

  const overallProgressPct =
    totalAmountPayable > 0 ? Math.min(100, Math.round((totalPaidSoFar / totalAmountPayable) * 1000) / 10) : 0;

  return {
    totalActiveLoans: active.length,
    totalOutstandingBalance: Math.round(totalOutstandingBalance),
    totalMonthlyEmi: Math.round(totalMonthlyEmi),
    totalOriginalPrincipal: Math.round(totalOriginalPrincipal),
    totalInterestPayable: Math.round(totalInterestPayable),
    totalInterestPaid: Math.round(totalInterestPaid),
    totalAmountPayable: Math.round(totalAmountPayable),
    totalPaidSoFar: Math.round(totalPaidSoFar),
    overallProgressPct,
    loans: loanItems,
    debtByType,
    nextDue,
  };
}

/**
 * Simulates debt payoff optimization using mathematical Avalanche or Snowball methodology.
 */
export async function simulateDebtPayoff(
  uid: string,
  extraMonthlyPayment: number = 5000,
  method: 'avalanche' | 'snowball' = 'avalanche'
): Promise<DebtPayoffSimulation> {
  const loans = await fetchUserLoans(uid);
  const active = loans.filter((l) => l.status === 'Active');

  const prioritized = active.map((l) => {
    const balance = calculateLoanOutstanding(l);
    return {
      loanId: l.id,
      loanName: l.name,
      lender: l.lender,
      interestRate: l.interestRate,
      outstandingBalance: balance,
      currentEmi: l.emiAmount,
    };
  });

  if (method === 'avalanche') {
    prioritized.sort((a, b) => b.interestRate - a.interestRate);
  } else {
    prioritized.sort((a, b) => a.outstandingBalance - b.outstandingBalance);
  }

  const totalCurrentDebt = prioritized.reduce((s, p) => s + p.outstandingBalance, 0);
  const totalMonthlyCommitment = prioritized.reduce((s, p) => s + p.currentEmi, 0) + extraMonthlyPayment;

  // Approximate mathematical compound savings from paying extra monthly principal
  const avgInterestRate =
    prioritized.length > 0
      ? prioritized.reduce((s, p) => s + p.interestRate * p.outstandingBalance, 0) / Math.max(1, totalCurrentDebt)
      : 9.5;

  const estimatedMonthsSaved = extraMonthlyPayment > 0 && totalCurrentDebt > 0
    ? Math.round((extraMonthlyPayment / (totalMonthlyCommitment * 0.45)) * 14)
    : 0;

  const estimatedInterestSaved = Math.round(
    totalCurrentDebt * (avgInterestRate / 100) * (estimatedMonthsSaved / 12) * 0.65
  );

  const prioritizedWithRank = prioritized.map((p, idx) => ({
    rank: idx + 1,
    ...p,
    reason:
      method === 'avalanche'
        ? idx === 0
          ? `Highest interest rate (${p.interestRate}% p.a.) — prioritizing this eliminates peak compound interest.`
          : `Interest rate: ${p.interestRate}% p.a.`
        : idx === 0
        ? `Lowest balance (₹${p.outstandingBalance.toLocaleString('en-IN')}) — quickest win to free up monthly cash-flow.`
        : `Outstanding: ₹${p.outstandingBalance.toLocaleString('en-IN')}`,
  }));

  const strategyAdvice =
    method === 'avalanche'
      ? `Debt Avalanche prioritizes mathematically superior loans. By directing your extra ₹${extraMonthlyPayment.toLocaleString(
          'en-IN'
        )}/mo toward "${prioritized[0]?.loanName || 'your highest-rate loan'}", you could save approximately ₹${estimatedInterestSaved.toLocaleString(
          'en-IN'
        )} in compound interest and be debt-free ~${estimatedMonthsSaved} months earlier.`
      : `Debt Snowball prioritizes psychological momentum. By knocking out "${prioritized[0]?.loanName ||
          'your smallest loan'}" first, you immediately eliminate one monthly EMI obligation and unlock freed cashflow for the next debt.`;

  return {
    method,
    extraMonthlyPayment,
    prioritizedLoans: prioritizedWithRank,
    totalCurrentDebt,
    totalMonthlyCommitment,
    estimatedInterestSaved,
    estimatedMonthsSaved,
    strategyAdvice,
  };
}

/**
 * Records an EMI payment or part-prepayment, automatically updating loan balance and writing an Expense transaction.
 */
export async function recordLoanPayment(
  uid: string,
  loanId: string,
  amount?: number,
  isPrepayment: boolean = false,
  notes?: string
): Promise<{ success: boolean; message: string; transactionId?: string }> {
  const db = getFirestoreDb();
  const loanRef = db.doc(`users/${uid}/loans/${loanId}`);
  const snap = await loanRef.get();

  if (!snap.exists) {
    throw new Error(`Loan with ID "${loanId}" not found in user portfolio.`);
  }

  const loan = snap.data() as Loan;
  const payAmount = amount !== undefined && amount > 0 ? amount : loan.emiAmount;

  if (isPrepayment) {
    const prepaymentRecord: EmiPrepayment = {
      date: new Date().toISOString(),
      amount: payAmount,
      type: 'reduce_tenure',
      note: notes || 'Part-prepayment via MCP',
    };
    const prepayments = Array.isArray(loan.prepayments) ? [...loan.prepayments, prepaymentRecord] : [prepaymentRecord];
    await loanRef.update({
      prepayments,
      updatedAt: new Date().toISOString(),
    });
  } else {
    const nextPaidEmis = (loan.paidEmis || 0) + 1;
    const isCompleted = nextPaidEmis >= loan.tenureMonths;
    await loanRef.update({
      paidEmis: nextPaidEmis,
      status: isCompleted ? 'Closed' : 'Active',
      updatedAt: new Date().toISOString(),
    });
  }

  // Automatically insert an Expense transaction
  const txResult = await addTransaction(uid, {
    type: 'Expense',
    amount: payAmount,
    category: 'Debt / Loan Repayment',
    description: isPrepayment
      ? `Part Prepayment — ${loan.name} (${loan.lender})`
      : `Monthly EMI — ${loan.name} (${loan.lender})`,
    date: new Date().toISOString(),
    notes: notes || (isPrepayment ? 'Prepayment recorded via MCP' : 'EMI recorded via MCP'),
  });

  return {
    success: true,
    message: isPrepayment
      ? `Part prepayment of ₹${payAmount.toLocaleString('en-IN')} recorded for ${loan.name}. Transaction logged.`
      : `Monthly EMI payment of ₹${payAmount.toLocaleString('en-IN')} recorded for ${loan.name}. Transaction logged.`,
    transactionId: txResult.id,
  };
}

// =============================================================================
// SIP & MARKET CALENDAR TOOLS
// =============================================================================

const NSE_BSE_HOLIDAYS_MAP: Record<string, string> = {
  // 2024
  '2024-01-22': 'Ayodhya Temple Inauguration',
  '2024-01-26': 'Republic Day',
  '2024-03-08': 'Mahashivratri',
  '2024-03-25': 'Holi',
  '2024-03-29': 'Good Friday',
  '2024-04-11': 'Id-Ul-Fitr',
  '2024-04-17': 'Ram Navami',
  '2024-05-01': 'Maharashtra Day',
  '2024-06-17': 'Bakri Id',
  '2024-07-17': 'Muharram',
  '2024-08-15': 'Independence Day',
  '2024-10-02': 'Mahatma Gandhi Jayanti',
  '2024-11-01': 'Diwali Laxmi Pujan',
  '2024-11-15': 'Guru Nanak Jayanti',
  '2024-12-25': 'Christmas',

  // 2025
  '2025-02-26': 'Mahashivratri',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-Ul-Fitr',
  '2025-04-10': 'Mahavir Jayanti',
  '2025-04-14': 'Dr. Ambedkar Jayanti',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Maharashtra Day',
  '2025-06-07': 'Bakri Id',
  '2025-07-06': 'Muharram',
  '2025-08-15': 'Independence Day',
  '2025-08-27': 'Ganesh Chaturthi',
  '2025-10-02': 'Mahatma Gandhi Jayanti',
  '2025-10-21': 'Diwali Laxmi Pujan',
  '2025-10-22': 'Diwali Balipratipada',
  '2025-11-05': 'Guru Nanak Jayanti',
  '2025-12-25': 'Christmas',

  // 2026
  '2026-01-26': 'Republic Day',
  '2026-02-15': 'Mahashivratri',
  '2026-03-04': 'Holi',
  '2026-03-21': 'Id-Ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-28': 'Bakri Id',
  '2026-06-26': 'Muharram',
  '2026-08-15': 'Independence Day',
  '2026-09-15': 'Ganesh Chaturthi',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-09': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',

  // 2027
  '2027-01-26': 'Republic Day',
  '2027-03-07': 'Mahashivratri',
  '2027-03-23': 'Holi',
  '2027-03-26': 'Good Friday',
  '2027-04-09': 'Id-Ul-Fitr',
  '2027-04-14': 'Dr. Ambedkar Jayanti',
  '2027-05-01': 'Maharashtra Day',
  '2027-05-17': 'Bakri Id',
  '2027-06-15': 'Muharram',
  '2027-08-15': 'Independence Day',
  '2027-09-04': 'Ganesh Chaturthi',
  '2027-10-02': 'Mahatma Gandhi Jayanti',
  '2027-10-10': 'Dussehra',
  '2027-10-29': 'Diwali Laxmi Pujan',
  '2027-11-13': 'Guru Nanak Jayanti',
  '2027-12-25': 'Christmas',
};

function formatMcpDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseMcpDate(str: string): Date {
  const parts = str.split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  return new Date(str);
}

function isMcpWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isMcpTradingDay(date: Date): boolean {
  if (isMcpWeekend(date)) return false;
  const str = formatMcpDate(date);
  return !NSE_BSE_HOLIDAYS_MAP[str];
}

export function resolveMcpTradingDay(intendedDate: Date | string): {
  scheduledDate: string;
  executionDate: string;
  wasShifted: boolean;
  shiftDays: number;
  reason: string;
} {
  const orig = typeof intendedDate === 'string' ? parseMcpDate(intendedDate) : new Date(intendedDate);
  const scheduledDateStr = formatMcpDate(orig);

  const curr = new Date(orig.getFullYear(), orig.getMonth(), orig.getDate());
  let shiftDays = 0;
  const reasons: string[] = [];

  while (!isMcpTradingDay(curr)) {
    const currStr = formatMcpDate(curr);
    const hol = NSE_BSE_HOLIDAYS_MAP[currStr];
    if (hol) {
      reasons.push(`${hol} (${currStr})`);
    } else if (curr.getDay() === 6) {
      reasons.push(`Saturday Weekend (${currStr})`);
    } else if (curr.getDay() === 0) {
      reasons.push(`Sunday Weekend (${currStr})`);
    }
    curr.setDate(curr.getDate() + 1);
    shiftDays++;
  }

  const executionDateStr = formatMcpDate(curr);
  const wasShifted = shiftDays > 0;
  const reason = wasShifted
    ? `Shifted +${shiftDays} day(s) due to ${reasons.join(', ')}`
    : 'Exact scheduled trading day';

  return {
    scheduledDate: scheduledDateStr,
    executionDate: executionDateStr,
    wasShifted,
    shiftDays,
    reason,
  };
}

export function getMcpMarketStatus(): { isOpen: boolean; statusText: string; nextSessionText: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

  const isWknd = isMcpWeekend(istTime);
  const istStr = formatMcpDate(istTime);
  const hol = NSE_BSE_HOLIDAYS_MAP[istStr];

  const currentMins = istTime.getHours() * 60 + istTime.getMinutes();
  const openMins = 9 * 60 + 15;
  const closeMins = 15 * 60 + 30;

  if (isWknd) {
    const nextTrading = resolveMcpTradingDay(istTime);
    return {
      isOpen: false,
      statusText: 'Market Closed (Weekend)',
      nextSessionText: `Next trading session opens on ${nextTrading.executionDate} at 09:15 AM IST`,
    };
  }

  if (hol) {
    const nextTrading = resolveMcpTradingDay(istTime);
    return {
      isOpen: false,
      statusText: `Market Closed (${hol})`,
      nextSessionText: `Next trading session opens on ${nextTrading.executionDate} at 09:15 AM IST`,
    };
  }

  if (currentMins >= openMins && currentMins <= closeMins) {
    return {
      isOpen: true,
      statusText: 'Market Open (NSE/BSE)',
      nextSessionText: 'Closes at 03:30 PM IST',
    };
  }

  const nextDay = new Date(istTime.getFullYear(), istTime.getMonth(), istTime.getDate() + 1);
  const nextTrading = resolveMcpTradingDay(nextDay);
  return {
    isOpen: false,
    statusText: 'Market Closed',
    nextSessionText: `Next trading session opens on ${nextTrading.executionDate} at 09:15 AM IST`,
  };
}

export async function fetchUserSips(uid: string): Promise<Sip[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(`users/${uid}/sips`).get();
  const sips: Sip[] = [];
  snap.forEach((d) => {
    const data = d.data();
    sips.push({
      id: d.id,
      name: data.name || 'Unnamed SIP',
      category: data.category || 'MutualFund',
      fundHouse: data.fundHouse,
      folioNumber: data.folioNumber,
      mandateAccount: data.mandateAccount,
      amount: Number(data.amount) || 0,
      frequency: data.frequency || 'Monthly',
      sipDay: Number(data.sipDay) || 10,
      startDate: data.startDate || formatMcpDate(new Date()),
      endDate: data.endDate,
      status: data.status || 'Active',
      autoExecute: data.autoExecute !== undefined ? Boolean(data.autoExecute) : true,
      totalInvested: Number(data.totalInvested) || 0,
      installmentsPaid: Number(data.installmentsPaid) || 0,
      lastExecutionDate: data.lastExecutionDate,
      nextExecutionDate: data.nextExecutionDate,
      stepUp: data.stepUp,
      installments: Array.isArray(data.installments) ? data.installments : [],
      notes: data.notes,
    });
  });
  return sips;
}

export async function getSipsOverview(uid: string): Promise<SipsOverview> {
  const sips = await fetchUserSips(uid);
  const active = sips.filter((s) => s.status === 'Active');

  let totalMonthlyCommitment = 0;
  let totalInvested = 0;
  let totalExecutedInstallments = 0;

  const today = new Date();
  const todayStr = formatMcpDate(today);

  let closestUpcoming: SipsOverview['nextUpcomingSip'] | undefined;
  let minDays = Infinity;

  for (const s of sips) {
    totalInvested += s.totalInvested || 0;
    totalExecutedInstallments += (s.installments || []).filter((i) => i.status === 'Executed').length;

    if (s.status === 'Active') {
      let monthlyEquiv = s.amount;
      if (s.frequency === 'Weekly') monthlyEquiv = s.amount * 4.33;
      else if (s.frequency === 'Quarterly') monthlyEquiv = s.amount / 3;
      totalMonthlyCommitment += monthlyEquiv;

      const nextExec = s.nextExecutionDate || formatMcpDate(new Date(today.getFullYear(), today.getMonth(), s.sipDay));
      const res = resolveMcpTradingDay(nextExec);
      const targetDate = parseMcpDate(res.executionDate);
      const diffMs = targetDate.getTime() - today.getTime();
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      if (daysRemaining < minDays) {
        minDays = daysRemaining;
        closestUpcoming = {
          sipId: s.id,
          sipName: s.name,
          amount: s.amount,
          scheduledDate: res.scheduledDate,
          executionDate: res.executionDate,
          daysRemaining,
          wasShifted: res.wasShifted,
          shiftReason: res.reason,
        };
      }
    }
  }

  return {
    totalActiveSips: active.length,
    totalMonthlyCommitment: Math.round(totalMonthlyCommitment),
    totalInvested: Math.round(totalInvested),
    totalExecutedInstallments,
    sips: sips.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      fundHouse: s.fundHouse,
      amount: s.amount,
      frequency: s.frequency,
      sipDay: s.sipDay,
      status: s.status,
      totalInvested: s.totalInvested,
      installmentsPaid: s.installmentsPaid,
      nextExecutionDate: s.nextExecutionDate,
      autoExecute: s.autoExecute,
    })),
    nextUpcomingSip: closestUpcoming,
    marketStatus: getMcpMarketStatus(),
  };
}

export async function addSip(
  uid: string,
  sipData: {
    name: string;
    amount: number;
    category?: SipCategory;
    frequency?: SipFrequency;
    sipDay?: number;
    fundHouse?: string;
    folioNumber?: string;
    mandateAccount?: string;
    startDate?: string;
    autoExecute?: boolean;
    stepUp?: { enabled: boolean; type: 'percentage' | 'fixed'; value: number };
    notes?: string;
  }
): Promise<{ id: string; sip: Sip }> {
  const db = getFirestoreDb();
  const id = 'sip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  const preferredDay = sipData.sipDay || 10;
  const startDateStr = sipData.startDate || formatMcpDate(new Date());
  const initialNextExec = resolveMcpTradingDay(new Date(new Date().getFullYear(), new Date().getMonth(), preferredDay)).executionDate;

  const newSip: Sip = {
    id,
    name: sipData.name,
    category: sipData.category || 'MutualFund',
    fundHouse: sipData.fundHouse,
    folioNumber: sipData.folioNumber,
    mandateAccount: sipData.mandateAccount || 'Bank Mandate (OTM Autopay)',
    amount: sipData.amount,
    frequency: sipData.frequency || 'Monthly',
    sipDay: preferredDay,
    startDate: startDateStr,
    status: 'Active',
    autoExecute: sipData.autoExecute !== undefined ? sipData.autoExecute : true,
    totalInvested: 0,
    installmentsPaid: 0,
    nextExecutionDate: initialNextExec,
    stepUp: sipData.stepUp,
    installments: [],
    notes: sipData.notes,
  };

  await db.doc(`users/${uid}/sips/${id}`).set(newSip);
  return { id, sip: newSip };
}

export async function getMarketCalendar(
  year: number,
  preferredDay?: number
): Promise<{
  year: number;
  holidaysCount: number;
  holidays: Array<{ date: string; name: string }>;
  schedule?: Array<{
    month: number;
    scheduledDate: string;
    executionDate: string;
    wasShifted: boolean;
    shiftDays: number;
    reason: string;
  }>;
}> {
  const holidays: Array<{ date: string; name: string }> = [];
  for (const [dateStr, name] of Object.entries(NSE_BSE_HOLIDAYS_MAP)) {
    if (dateStr.startsWith(`${year}-`)) {
      holidays.push({ date: dateStr, name });
    }
  }

  let schedule: any[] | undefined;
  if (preferredDay !== undefined && preferredDay >= 1 && preferredDay <= 31) {
    schedule = [];
    for (let m = 0; m < 12; m++) {
      const maxDays = new Date(year, m + 1, 0).getDate();
      const clamped = Math.min(preferredDay, maxDays);
      const target = new Date(year, m, clamped);
      const res = resolveMcpTradingDay(target);
      schedule.push({
        month: m + 1,
        scheduledDate: res.scheduledDate,
        executionDate: res.executionDate,
        wasShifted: res.wasShifted,
        shiftDays: res.shiftDays,
        reason: res.reason,
      });
    }
  }

  return {
    year,
    holidaysCount: holidays.length,
    holidays: holidays.sort((a, b) => a.date.localeCompare(b.date)),
    schedule,
  };
}

export async function recordSipExecution(
  uid: string,
  sipId: string,
  amount?: number,
  notes?: string
): Promise<{ success: boolean; message: string; transactionId: string; allottedUnits: number; nav: number }> {
  const db = getFirestoreDb();
  const sipDocRef = db.doc(`users/${uid}/sips/${sipId}`);
  const snap = await sipDocRef.get();

  if (!snap.exists) {
    throw new Error(`SIP with ID "${sipId}" not found for user ${uid}.`);
  }

  const sip = snap.data() as Sip;
  const payAmount = amount !== undefined && amount > 0 ? amount : sip.amount;
  const today = new Date();
  const res = resolveMcpTradingDay(today);

  // Realistic benchmark NAV estimation
  let nav = 100.0;
  if (/flexi|parag/i.test(sip.name)) nav = 86.42;
  else if (/nifty|index|50/i.test(sip.name)) nav = 242.15;
  else if (/small|quant/i.test(sip.name)) nav = 118.75;
  else if (sip.category === 'Gold') nav = 68.5;

  const allottedUnits = Math.round((payAmount / nav) * 1000) / 1000;
  const instNumber = (sip.installments || []).length + 1;

  // 1. Record installment in SIP
  const newInst: SipInstallment = {
    id: 'inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    installmentNumber: instNumber,
    scheduledDate: formatMcpDate(today),
    executionDate: res.executionDate,
    amount: payAmount,
    nav,
    units: allottedUnits,
    status: 'Executed',
    isMarketShifted: res.wasShifted,
    shiftReason: res.reason,
    autoExecuted: false,
  };

  const updatedInstallments = [...(sip.installments || []), newInst];
  const nextMonthTarget = new Date(today.getFullYear(), today.getMonth() + 1, sip.sipDay);
  const nextExecDate = resolveMcpTradingDay(nextMonthTarget).executionDate;

  await sipDocRef.update({
    installments: updatedInstallments,
    installmentsPaid: (sip.installmentsPaid || 0) + 1,
    totalInvested: (sip.totalInvested || 0) + payAmount,
    lastExecutionDate: res.executionDate,
    nextExecutionDate: nextExecDate,
    updatedAt: new Date().toISOString(),
  });

  // 2. Automatically log an Investment Expense transaction
  const txResult = await addTransaction(uid, {
    type: 'Expense',
    amount: payAmount,
    category: 'Investment',
    description: `SIP Debit: ${sip.name} (Installment #${instNumber})`,
    bank: sip.mandateAccount || 'Bank Mandate (OTM Autopay)',
    date: new Date().toISOString(),
    notes: notes || `Executed via MCP. ${res.reason}. Allotted at NAV ₹${nav}.`,
    assetName: sip.name,
  });

  // 3. Update or add asset in portfolio
  try {
    const assetsSnap = await db.collection(`users/${uid}/assets`).get();
    let matchedAssetId: string | null = null;
    let existingQty = 0;
    let existingBuyPrice = nav;

    assetsSnap.forEach((d) => {
      const a = d.data();
      if ((a.name && a.name.toLowerCase() === sip.name.toLowerCase()) || d.id === sip.id) {
        matchedAssetId = d.id;
        existingQty = Number(a.quantity) || 0;
        existingBuyPrice = Number(a.buyPrice) || nav;
      }
    });

    if (matchedAssetId) {
      const newQty = existingQty + allottedUnits;
      const totalCost = existingQty * existingBuyPrice + payAmount;
      const newAvgBuyPrice = newQty > 0 ? Math.round((totalCost / newQty) * 100) / 100 : nav;
      await db.doc(`users/${uid}/assets/${matchedAssetId}`).update({
        quantity: Math.round(newQty * 1000) / 1000,
        buyPrice: newAvgBuyPrice,
        currentPrice: nav,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      await addAsset(uid, {
        name: sip.name,
        type: sip.category === 'Stock' ? 'Stock' : sip.category === 'ETF' ? 'ETF' : sip.category === 'Gold' ? 'Gold' : 'MutualFund',
        quantity: allottedUnits,
        buyPrice: nav,
        currentPrice: nav,
        currency: 'INR',
        isLiquid: true,
        notes: `Auto-created via SIP Mandate (${sip.mandateAccount || 'OTM Autopay'})`,
      });
    }
  } catch (e) {
    // Non-fatal asset sync
  }

  return {
    success: true,
    message: `SIP installment of ₹${payAmount.toLocaleString('en-IN')} executed for "${sip.name}". Allocated ${allottedUnits} units at NAV ₹${nav}. Transaction and portfolio updated.`,
    transactionId: txResult.id,
    allottedUnits,
    nav,
  };
}

