export type CompactNumberFormat = 'short' | 'long' | 'currency';

/**
 * Pure helper function to format numbers into compact Indian notations (Cr, L, K).
 * Usable both in Angular templates via CompactNumberPipe and directly in services, exports, and charts.
 */
export function formatCompactNumber(
  value: number | string | null | undefined,
  format: CompactNumberFormat = 'short',
  decimals: number = 2
): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return String(value);

  const isNegative = num < 0;
  const absVal = Math.abs(num);
  const sign = isNegative ? '-' : '';
  const prefix = format === 'currency' ? '₹' : '';

  const formatNumber = (val: number, maxDecimals: number): string => {
    const fixed = val.toFixed(maxDecimals);
    return fixed.replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
  };

  // Threshold 1: Crore (>= 1,00,00,000)
  if (absVal >= 10000000) {
    const cr = formatNumber(absVal / 10000000, decimals);
    return `${sign}${prefix}${cr} Cr`;
  }

  // Threshold 2: Lakh (>= 1,00,000)
  if (absVal >= 100000) {
    const l = formatNumber(absVal / 100000, decimals);
    const unit = format === 'long' ? ' Lakh' : ' L';
    return `${sign}${prefix}${l}${unit}`;
  }

  // Threshold 3: Thousand (>= 1,000)
  if (absVal >= 1000) {
    const k = formatNumber(absVal / 1000, 1);
    return `${sign}${prefix}${k}K`;
  }

  // Below 1,000
  return `${sign}${prefix}${absVal}`;
}
