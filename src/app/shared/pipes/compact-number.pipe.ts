import { Pipe, PipeTransform } from '@angular/core';

export type CompactNumberFormat = 'short' | 'long' | 'currency';

@Pipe({
  name: 'compactNumber',
  standalone: true,
})
export class CompactNumberPipe implements PipeTransform {
  transform(
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

    // Threshold 1: Crore (>= 1,00,00,000)
    if (absVal >= 10000000) {
      const cr = this.formatNumber(absVal / 10000000, decimals);
      return `${sign}${prefix}${cr} Cr`;
    }

    // Threshold 2: Lakh (>= 1,00,000)
    if (absVal >= 100000) {
      const l = this.formatNumber(absVal / 100000, decimals);
      const unit = format === 'long' ? ' Lakh' : ' L';
      return `${sign}${prefix}${l}${unit}`;
    }

    // Threshold 3: Thousand (>= 1,000)
    if (absVal >= 1000) {
      const k = this.formatNumber(absVal / 1000, 1);
      return `${sign}${prefix}${k}K`;
    }

    // Below 1,000
    return `${sign}${prefix}${absVal}`;
  }

  private formatNumber(val: number, maxDecimals: number): string {
    const fixed = val.toFixed(maxDecimals);
    return fixed.replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
  }
}
