// Dates are ISO strings ('2026-11-11'), months are 'YYYY-MM'. Everything is local time.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toISO(new Date());
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export const monthOf = (iso: string) => iso.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** The `n` months ending at `end`, oldest first. */
export function monthsEnding(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
}

export function monthLabel(month: string, style: 'short' | 'long' = 'long'): string {
  const d = parseISO(month + '-01');
  return d.toLocaleDateString(undefined, style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });
}

export function dayLabel(iso: string, withYear = false): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Years (with fraction) from one date to another. */
export function yearsBetween(a: string, b: string): number {
  return daysBetween(a, b) / 365.25;
}
