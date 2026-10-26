/**
 * SIP Automation & Scheduled Installment Worker
 * DM FinTracker Backend Scheduler (Asia/Kolkata Timezone)
 *
 * Requirements:
 * - Runs daily at 06:00 AM IST (Asia/Kolkata) before market opening.
 * - Idempotently pre-generates expected installments for active plans.
 * - Uses deterministic IDs: `${sipId}_${scheduledDate.replace(/-/g, '')}`.
 * - Never marks installments as paid or allotted solely because dates pass.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Admin SDK if service account is provided in environment
if (getApps().length === 0) {
  if (process.env['FIREBASE_SERVICE_ACCOUNT_KEY']) {
    const serviceAccount = JSON.parse(process.env['FIREBASE_SERVICE_ACCOUNT_KEY']);
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }
}

const db = getFirestore();

interface MarketHoliday {
  date: string;
  name: string;
}

// 2024–2027 NSE/BSE/AMFI Clearing Holiday Excerpts
const MARKET_HOLIDAYS_SET = new Set<string>([
  '2024-01-26', '2024-03-08', '2024-03-25', '2024-03-29', '2024-04-11', '2024-04-17',
  '2024-05-01', '2024-06-17', '2024-07-17', '2024-08-15', '2024-10-02', '2024-11-01',
  '2024-11-15', '2024-12-25',
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21',
  '2025-10-22', '2025-11-05', '2025-12-25',
  '2026-01-26', '2026-03-03', '2026-03-20', '2026-03-30', '2026-04-03', '2026-04-14',
  '2026-05-01', '2026-05-28', '2026-08-15', '2026-08-26', '2026-10-02', '2026-10-20',
  '2026-11-10', '2026-11-24', '2026-12-25',
  '2027-01-26', '2027-03-08', '2027-03-22', '2027-03-26', '2027-04-14', '2027-05-01',
  '2027-08-15', '2027-10-02', '2027-10-18', '2027-11-01', '2027-12-25',
]);

function isMarketTradingDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false; // Sunday or Saturday
  const dateStr = formatDate(d);
  return !MARKET_HOLIDAYS_SET.has(dateStr);
}

function resolveTradingDay(scheduledDate: Date): { scheduledDate: string; executionDate: string; wasShifted: boolean; reason: string } {
  const schedStr = formatDate(scheduledDate);
  const curr = new Date(scheduledDate.getTime());
  let shiftDays = 0;

  while (!isMarketTradingDay(curr)) {
    curr.setDate(curr.getDate() + 1);
    shiftDays++;
  }

  const execStr = formatDate(curr);
  return {
    scheduledDate: schedStr,
    executionDate: execStr,
    wasShifted: shiftDays > 0,
    reason: shiftDays > 0
      ? `Shifted +${shiftDays} day(s) due to weekend/market holiday ➔ Executed on ${execStr}`
      : 'Open market trading day',
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Execute daily scheduled synchronization for all active user SIPs.
 */
export async function runDailySipScheduler(): Promise<{ totalUsers: number; totalSipsChecked: number; totalInstallmentsGenerated: number }> {
  console.log(`[SipScheduler] Starting scheduled sync job in Asia/Kolkata timezone at ${new Date().toISOString()}`);

  const usersSnap = await db.collection('users').get();
  let totalSipsChecked = 0;
  let totalInstallmentsGenerated = 0;

  const today = new Date();
  const monthsAhead = 3;
  const targetDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
  const endYear = targetDate.getFullYear();
  const endMonth = targetDate.getMonth();

  for (const userDoc of usersSnap.docs) {
    const sipsSnap = await db.collection(`users/${userDoc.id}/sips`).where('status', '==', 'Active').get();

    for (const sipDoc of sipsSnap.docs) {
      totalSipsChecked++;
      const sip = sipDoc.data();
      const existingInstallments: any[] = sip['installments'] || [];
      const existingMap = new Map<string, any>();
      existingInstallments.forEach((inst) => {
        existingMap.set(inst.id, inst);
        if (inst.scheduledDate) existingMap.set(inst.scheduledDate, inst);
      });

      const startDate = new Date(sip['startDate'] || formatDate(today));
      const endDate = sip['endDate'] ? new Date(sip['endDate']) : null;

      let currYear = Math.max(startDate.getFullYear(), today.getFullYear() - 1);
      let currMonth = currYear === today.getFullYear() ? today.getMonth() : startDate.getMonth();
      let installmentNumber = existingInstallments.length;
      let newInstallmentsAdded = 0;

      while (currYear < endYear || (currYear === endYear && currMonth <= endMonth)) {
        const maxDays = new Date(currYear, currMonth + 1, 0).getDate();
        const clampedDay = Math.min(sip['sipDay'] || 10, maxDays);
        const schedObj = new Date(currYear, currMonth, clampedDay);

        if (schedObj >= startDate && (!endDate || schedObj <= endDate)) {
          const res = resolveTradingDay(schedObj);
          const deterministicId = `${sipDoc.id}_${res.scheduledDate.replace(/-/g, '')}`;

          if (!existingMap.has(deterministicId) && !existingMap.has(res.scheduledDate)) {
            installmentNumber++;
            const newInst = {
              id: deterministicId,
              installmentNumber,
              scheduledDate: res.scheduledDate,
              executionDate: res.executionDate,
              amount: sip['amount'],
              paymentStatus: 'Pending',
              allotmentStatus: 'Pending',
              reconciliationStatus: 'Unreconciled',
              status: 'Scheduled',
              isMarketShifted: res.wasShifted,
              shiftReason: res.reason,
              autoExecuted: false,
              notes: res.wasShifted
                ? `Market holiday rollover: Scheduled on ${res.scheduledDate} ➔ Trading day ${res.executionDate}`
                : 'Scheduled for mutual fund cutoff window.',
            };

            existingInstallments.push(newInst);
            existingMap.set(deterministicId, newInst);
            newInstallmentsAdded++;
            totalInstallmentsGenerated++;
          }
        }

        // Increment monthly
        currMonth++;
        if (currMonth > 11) {
          currYear += Math.floor(currMonth / 12);
          currMonth = currMonth % 12;
        }
      }

      if (newInstallmentsAdded > 0) {
        existingInstallments.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
        await sipDoc.ref.update({
          installments: existingInstallments,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  console.log(`[SipScheduler] Completed sync: Checked ${totalSipsChecked} SIPs across ${usersSnap.docs.length} users, generated ${totalInstallmentsGenerated} upcoming installments.`);
  return {
    totalUsers: usersSnap.docs.length,
    totalSipsChecked,
    totalInstallmentsGenerated,
  };
}

if (require.main === module) {
  runDailySipScheduler()
    .then((res) => {
      console.log('Daily SIP Scheduler run succeeded:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Daily SIP Scheduler run failed:', err);
      process.exit(1);
    });
}
