import { useMemo } from 'react';
import { usePlanDocument, UsePlanDocumentResult } from './usePlanDocument';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type DayState = UsePlanDocumentResult & { date: string };

// Fixed count of 7 days — hooks must be called unconditionally
const DAY_COUNT = 7;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMultiDayPlan(startDate: string): DayState[] {
  const d0 = usePlanDocument(startDate);
  const d1 = usePlanDocument(addDays(startDate, 1));
  const d2 = usePlanDocument(addDays(startDate, 2));
  const d3 = usePlanDocument(addDays(startDate, 3));
  const d4 = usePlanDocument(addDays(startDate, 4));
  const d5 = usePlanDocument(addDays(startDate, 5));
  const d6 = usePlanDocument(addDays(startDate, 6));

  return useMemo(() => [
    { ...d0, date: startDate },
    { ...d1, date: addDays(startDate, 1) },
    { ...d2, date: addDays(startDate, 2) },
    { ...d3, date: addDays(startDate, 3) },
    { ...d4, date: addDays(startDate, 4) },
    { ...d5, date: addDays(startDate, 5) },
    { ...d6, date: addDays(startDate, 6) },
  ], [d0, d1, d2, d3, d4, d5, d6, startDate]);
}
