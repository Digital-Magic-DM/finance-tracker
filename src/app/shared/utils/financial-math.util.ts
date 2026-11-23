/**
 * High-precision pure financial mathematical utilities.
 * Handles precision rounding, gain/loss calculations, EMI formulas,
 * amortization math, CAGR, and financial runway metrics.
 */

/**
 * Rounds a monetary figure to 2 decimal places using Number.EPSILON to eliminate floating-point drift.
 */
export function roundCurrency(amount: number): number {
  if (isNaN(amount) || !isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates absolute gain or loss (Current Value - Invested Capital).
 */
export function calculateGain(currentValue: number, investedAmount: number): number {
  return roundCurrency(currentValue - investedAmount);
}

/**
 * Calculates return percentage: ((Current Value - Invested) / Invested) * 100.
 * Returns 0 if invested amount is <= 0 or invalid.
 */
export function calculateGainPercentage(currentValue: number, investedAmount: number): number {
  if (isNaN(investedAmount) || isNaN(currentValue) || investedAmount <= 0) {
    return 0;
  }
  const gain = currentValue - investedAmount;
  const pct = (gain / investedAmount) * 100;
  return roundCurrency(pct);
}

/**
 * Calculates monthly EMI using the standard reducing balance compounding formula:
 * EMI = [P * r * (1 + r)^n] / [(1 + r)^n - 1]
 * where r = annualInterestRatePct / (12 * 100), n = tenureMonths.
 * For 0% interest loans, returns principal / tenureMonths.
 */
export function calculateEmi(principal: number, annualInterestRatePct: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  if (annualInterestRatePct <= 0) {
    return roundCurrency(principal / tenureMonths);
  }
  const monthlyRate = annualInterestRatePct / (12 * 100);
  const compound = Math.pow(1 + monthlyRate, tenureMonths);
  if (compound === 1 || isNaN(compound)) return roundCurrency(principal / tenureMonths);

  const emi = (principal * monthlyRate * compound) / (compound - 1);
  return roundCurrency(emi);
}

/**
 * Calculates Compound Annual Growth Rate (CAGR).
 * CAGR = (End Value / Start Value) ^ (1 / years) - 1
 * Returns 0 if years <= 0 or startValue <= 0.
 */
export function calculateCagr(startValue: number, endValue: number, years: number): number {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return 0;
  const cagr = Math.pow(endValue / startValue, 1 / years) - 1;
  return roundCurrency(cagr * 100);
}

/**
 * Calculates emergency fund runway in months: Liquid Assets / Monthly Expenses.
 */
export function calculateEmergencyRunway(liquidCapital: number, monthlyExpense: number): number {
  if (monthlyExpense <= 0 || liquidCapital <= 0) return 0;
  return roundCurrency(liquidCapital / monthlyExpense);
}

/**
 * Calculates target retirement corpus using the 4% rule (annual expenses * multiplier, default 25x).
 */
export function calculateRetirementCorpus(annualExpense: number, multiplier = 25): number {
  if (annualExpense <= 0) return 0;
  return roundCurrency(annualExpense * multiplier);
}
