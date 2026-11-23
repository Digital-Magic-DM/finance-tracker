import { Pipe, PipeTransform } from '@angular/core';
import { CompactNumberFormat, formatCompactNumber } from '../utils/format.util';

export type { CompactNumberFormat };
export { formatCompactNumber };

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
    return formatCompactNumber(value, format, decimals);
  }
}
