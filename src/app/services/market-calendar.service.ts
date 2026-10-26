import { Injectable } from '@angular/core';
import { MarketHoliday, TradingDayResolution, YearlyScheduleEntry } from '../models/sip.models';

/**
 * Official NSE / BSE / AMFI Clearing Market Holidays Database.
 * In the real world, if a SIP due date falls on a weekend or a trading/clearing holiday,
 * the bank debit and unit allotment (NAV purchase) automatically execute on the
 * NEXT WORKING BUSINESS DAY (T+0 or next open trading session).
 */
const NSE_BSE_HOLIDAYS: Record<string, string> = {
  // ── 2024 Holidays ──
  '2024-01-22': 'Special Holiday (Ayodhya Temple Inauguration)',
  '2024-01-26': 'Republic Day',
  '2024-03-08': 'Mahashivratri',
  '2024-03-25': 'Holi',
  '2024-03-29': 'Good Friday',
  '2024-04-11': 'Id-Ul-Fitr (Ramzan Id)',
  '2024-04-17': 'Ram Navami',
  '2024-05-01': 'Maharashtra Day',
  '2024-05-20': 'General Parliamentary Elections (Mumbai)',
  '2024-06-17': 'Bakri Id / Eid-Ul-Adha',
  '2024-07-17': 'Muharram',
  '2024-08-15': 'Independence Day',
  '2024-10-02': 'Mahatma Gandhi Jayanti',
  '2024-11-01': 'Diwali Laxmi Pujan (Clearing Closed)',
  '2024-11-15': 'Guru Nanak Jayanti',
  '2024-11-20': 'Maharashtra Assembly Elections',
  '2024-12-25': 'Christmas',

  // ── 2025 Holidays ──
  '2025-02-26': 'Mahashivratri',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-Ul-Fitr',
  '2025-04-10': 'Mahavir Jayanti',
  '2025-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Maharashtra Day',
  '2025-06-07': 'Bakri Id / Eid-Ul-Adha',
  '2025-07-06': 'Muharram',
  '2025-08-15': 'Independence Day',
  '2025-08-27': 'Ganesh Chaturthi',
  '2025-10-02': 'Mahatma Gandhi Jayanti',
  '2025-10-21': 'Diwali Laxmi Pujan',
  '2025-10-22': 'Diwali Balipratipada',
  '2025-11-05': 'Guru Nanak Jayanti',
  '2025-12-25': 'Christmas',

  // ── 2026 Holidays ──
  '2026-01-26': 'Republic Day',
  '2026-02-15': 'Mahashivratri',
  '2026-03-04': 'Holi',
  '2026-03-21': 'Id-Ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-28': 'Bakri Id / Eid-Ul-Adha',
  '2026-06-26': 'Muharram',
  '2026-08-15': 'Independence Day',
  '2026-09-15': 'Ganesh Chaturthi',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-09': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',

  // ── 2027 Holidays ──
  '2027-01-26': 'Republic Day',
  '2027-03-07': 'Mahashivratri',
  '2027-03-23': 'Holi',
  '2027-03-26': 'Good Friday',
  '2027-04-09': 'Id-Ul-Fitr',
  '2027-04-14': 'Dr. Ambedkar Jayanti',
  '2027-05-01': 'Maharashtra Day',
  '2027-05-17': 'Bakri Id / Eid-Ul-Adha',
  '2027-06-15': 'Muharram',
  '2027-08-15': 'Independence Day',
  '2027-09-04': 'Ganesh Chaturthi',
  '2027-10-02': 'Mahatma Gandhi Jayanti',
  '2027-10-10': 'Dussehra',
  '2027-10-29': 'Diwali Laxmi Pujan',
  '2027-11-13': 'Guru Nanak Jayanti',
  '2027-12-25': 'Christmas',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Injectable({
  providedIn: 'root',
})
export class MarketCalendarService {
  /**
   * Format Date to YYYY-MM-DD
   */
  formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Parse YYYY-MM-DD to local Date object safely without timezone skew
   */
  parseDate(dateStr: string): Date {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(dateStr);
  }

  /**
   * Check if a day is Saturday (6) or Sunday (0)
   */
  isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  /**
   * Check if a date string YYYY-MM-DD is an exchange holiday
   */
  getHoliday(dateStr: string): MarketHoliday | null {
    const name = NSE_BSE_HOLIDAYS[dateStr];
    if (!name) return null;

    const d = this.parseDate(dateStr);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return {
      date: dateStr,
      name,
      day: dayNames[d.getDay()],
      year: d.getFullYear(),
      clearingClosed: true,
    };
  }

  /**
   * Returns true if the market is open for trading and clearing on this date
   * (Not a Saturday, not a Sunday, and not a declared exchange holiday)
   */
  isTradingDay(date: Date): boolean {
    if (this.isWeekend(date)) return false;
    const str = this.formatDate(date);
    if (NSE_BSE_HOLIDAYS[str]) return false;
    return true;
  }

  /**
   * Core Real-World SIP Resolution:
   * Takes the user's preferred scheduled date (e.g. 15th of month).
   * If it falls on Saturday, Sunday, or a Market Holiday,
   * it rolls forward to the NEXT WORKING TRADING DAY!
   */
  resolveTradingDay(intendedDate: Date | string): TradingDayResolution {
    const orig = typeof intendedDate === 'string' ? this.parseDate(intendedDate) : new Date(intendedDate);
    const scheduledDateStr = this.formatDate(orig);

    let curr = new Date(orig.getFullYear(), orig.getMonth(), orig.getDate());
    let shiftDays = 0;
    const reasons: string[] = [];

    while (!this.isTradingDay(curr)) {
      const currStr = this.formatDate(curr);
      const hol = this.getHoliday(currStr);
      const isSun = curr.getDay() === 0;
      const isSat = curr.getDay() === 6;

      if (hol) {
        reasons.push(`${hol.name} (${curr.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })})`);
      } else if (isSat) {
        reasons.push(`Saturday Weekend (${curr.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })})`);
      } else if (isSun) {
        reasons.push(`Sunday Weekend (${curr.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })})`);
      }

      // Advance by 1 day
      curr.setDate(curr.getDate() + 1);
      shiftDays++;
    }

    const executionDateStr = this.formatDate(curr);
    const wasShifted = shiftDays > 0;

    let reason = 'Exact scheduled trading day';
    if (wasShifted) {
      reason = `Shifted +${shiftDays} day${shiftDays > 1 ? 's' : ''} due to ${reasons.join(', ')}`;
    }

    return {
      scheduledDate: scheduledDateStr,
      executionDate: executionDateStr,
      wasShifted,
      shiftDays,
      reason,
    };
  }

  /**
   * Generate the 12-month calendar schedule for a given preferred SIP day
   */
  generateYearlySchedule(preferredDay: number, year: number): YearlyScheduleEntry[] {
    const today = new Date();
    const todayStr = this.formatDate(today);
    const entries: YearlyScheduleEntry[] = [];

    let nextUpcomingFound = false;

    for (let month = 0; month < 12; month++) {
      // Find maximum days in this month (e.g. 28/29 for Feb, 30 for Apr)
      const maxDaysInMonth = new Date(year, month + 1, 0).getDate();
      const clampedDay = Math.min(preferredDay, maxDaysInMonth);

      const targetDate = new Date(year, month, clampedDay);
      const resolution = this.resolveTradingDay(targetDate);

      const isPast = resolution.executionDate < todayStr;
      const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

      let isNextUpcoming = false;
      if (!isPast && !nextUpcomingFound) {
        isNextUpcoming = true;
        nextUpcomingFound = true;
      }

      entries.push({
        monthIndex: month,
        monthName: MONTH_NAMES[month],
        scheduledDateStr: resolution.scheduledDate,
        executionDateStr: resolution.executionDate,
        wasShifted: resolution.wasShifted,
        shiftDays: resolution.shiftDays,
        reason: resolution.reason,
        isPast,
        isCurrentMonth,
        isNextUpcoming,
      });
    }

    return entries;
  }

  /**
   * Get all registered holidays for a particular year
   */
  getHolidaysForYear(year: number): MarketHoliday[] {
    const results: MarketHoliday[] = [];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const [dateStr, name] of Object.entries(NSE_BSE_HOLIDAYS)) {
      if (dateStr.startsWith(`${year}-`)) {
        const d = this.parseDate(dateStr);
        results.push({
          date: dateStr,
          name,
          day: dayNames[d.getDay()],
          year,
          clearingClosed: true,
        });
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get live market session status (IST)
   */
  getMarketStatus(): { isOpen: boolean; statusText: string; nextSessionText: string } {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

    const isWknd = this.isWeekend(istTime);
    const istDateStr = this.formatDate(istTime);
    const holiday = this.getHoliday(istDateStr);

    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const currentMins = hours * 60 + minutes;

    const marketOpenMins = 9 * 60 + 15; // 09:15 AM
    const marketCloseMins = 15 * 60 + 30; // 03:30 PM

    if (isWknd) {
      const nextTrading = this.resolveTradingDay(istTime);
      return {
        isOpen: false,
        statusText: 'Market Closed (Weekend)',
        nextSessionText: `Next trading session opens on ${this.formatReadableDate(nextTrading.executionDate)} at 09:15 AM IST`,
      };
    }

    if (holiday) {
      const nextTrading = this.resolveTradingDay(istTime);
      return {
        isOpen: false,
        statusText: `Market Closed (${holiday.name})`,
        nextSessionText: `Next trading session opens on ${this.formatReadableDate(nextTrading.executionDate)} at 09:15 AM IST`,
      };
    }

    if (currentMins < marketOpenMins) {
      const diffMins = marketOpenMins - currentMins;
      const h = Math.floor(diffMins / 60);
      const m = diffMins % 60;
      const countStr = h > 0 ? `${h}h ${m}m` : `${m} mins`;
      return {
        isOpen: false,
        statusText: 'Pre-Market / Closed',
        nextSessionText: `Opens today at 09:15 AM IST (in ${countStr})`,
      };
    }

    if (currentMins >= marketOpenMins && currentMins <= marketCloseMins) {
      const remainingMins = marketCloseMins - currentMins;
      const h = Math.floor(remainingMins / 60);
      const m = remainingMins % 60;
      return {
        isOpen: true,
        statusText: 'Market Open (NSE/BSE)',
        nextSessionText: `Closes at 03:30 PM IST (${h}h ${m}m remaining)`,
      };
    }

    // After 3:30 PM IST on weekday
    const nextDay = new Date(istTime.getFullYear(), istTime.getMonth(), istTime.getDate() + 1);
    const nextTrading = this.resolveTradingDay(nextDay);
    return {
      isOpen: false,
      statusText: 'Market Closed for Today',
      nextSessionText: `Next trading session opens on ${this.formatReadableDate(nextTrading.executionDate)} at 09:15 AM IST`,
    };
  }

  formatReadableDate(dateStr: string): string {
    const d = this.parseDate(dateStr);
    return d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /**
   * Helper to build monthly visual grid (1..31 days) for calendar view
   */
  getMonthCalendarDays(year: number, monthIndex: number, highlightedDay?: number) {
    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0: Sun ... 6: Sat

    const days: Array<{
      dayNumber: number | null;
      dateStr: string | null;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName?: string;
      isTradingDay: boolean;
      isPreferredSipDay: boolean;
      isShiftedExecutionDay: boolean;
    }> = [];

    // Empty lead cells for calendar grid alignment
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({
        dayNumber: null,
        dateStr: null,
        isWeekend: false,
        isHoliday: false,
        isTradingDay: false,
        isPreferredSipDay: false,
        isShiftedExecutionDay: false,
      });
    }

    let shiftedTargetDay: number | null = null;
    if (highlightedDay) {
      const clamped = Math.min(highlightedDay, daysInMonth);
      const targetDate = new Date(year, monthIndex, clamped);
      const res = this.resolveTradingDay(targetDate);
      if (res.wasShifted) {
        const resDate = this.parseDate(res.executionDate);
        if (resDate.getMonth() === monthIndex) {
          shiftedTargetDay = resDate.getDate();
        }
      }
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, monthIndex, day);
      const str = this.formatDate(d);
      const wknd = this.isWeekend(d);
      const hol = this.getHoliday(str);
      const isTrading = !wknd && !hol;
      const isPref = highlightedDay ? Math.min(highlightedDay, daysInMonth) === day : false;
      const isShifted = shiftedTargetDay === day;

      days.push({
        dayNumber: day,
        dateStr: str,
        isWeekend: wknd,
        isHoliday: !!hol,
        holidayName: hol?.name,
        isTradingDay: isTrading,
        isPreferredSipDay: isPref,
        isShiftedExecutionDay: isShifted,
      });
    }

    return days;
  }
}
