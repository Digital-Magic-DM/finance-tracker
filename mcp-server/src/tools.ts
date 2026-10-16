import { getFirestoreDb } from './firebase.js';
import { Asset, Transaction, NetWorthOverview, CashFlowSummary, AssetType, TransactionType } from './types.js';

export function resolveUserId(explicitUid?: string): string {
  const uid = explicitUid || process.env.DEFAULT_USER_UID;
  if (!uid) {
    throw new Error(
      'User ID is required. Please provide "uid" parameter or configure DEFAULT_USER_UID in the server environment variables.'
    );
  }
  return uid;
}

/**
 * Calculates total net worth, invested value, current value, liquid balance, and asset allocation breakdown.
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
      isLiquid: Boolean(data.isLiquid || data.type === 'Cash' || data.type === 'FixedDeposit'),
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

  const totalProfit = totalCurrentValue - totalInvested;
  const profitPercentage = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

  for (const key of Object.keys(breakdown)) {
    breakdown[key].percentage =
      totalCurrentValue > 0 ? (breakdown[key].value / totalCurrentValue) * 100 : 0;
    breakdown[key].value = Math.round(breakdown[key].value * 100) / 100;
    breakdown[key].percentage = Math.round(breakdown[key].percentage * 10) / 10;
  }

  return {
    totalNetWorth: Math.round(totalCurrentValue * 100) / 100,
    totalInvested: Math.round(totalInvested * 100) / 100,
    totalCurrentValue: Math.round(totalCurrentValue * 100) / 100,
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
      isLiquid: Boolean(data.isLiquid || data.type === 'Cash' || data.type === 'FixedDeposit'),
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
