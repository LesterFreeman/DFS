import { toISO } from './dates';

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  // Semicolon or tab separated exports are common outside the US.
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-|−/.test(s) || /\bDR\b/i.test(s)) negative = !negative;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  // "1.234,56" (decimal comma) vs "1,234.56"
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // Month first unless that is impossible.
    return +m[1] > 12 ? valid(year, +m[2], +m[1]) : valid(year, +m[1], +m[2]);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toISO(d);
}

function valid(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toISO(date) : null;
}

export interface CsvRow {
  date: string;
  merchant: string;
  amount: number;
  /** Category text from the file, if it had one. */
  category?: string;
}

export interface CsvResult {
  rows: CsvRow[];
  skipped: number;
  /** True when charges look positive in the file (typical for card exports), so signs should be flipped. */
  chargesPositive: boolean;
  error?: string;
}

const find = (header: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function readTransactionsCsv(text: string): CsvResult {
  const table = parseCSV(text);
  // The header is the first row that names a date column; banks often put account details above it.
  const headerIdx = table.findIndex((r) => r.some((c) => /date/i.test(c)));
  if (headerIdx < 0) return { rows: [], skipped: 0, chargesPositive: false, error: 'No "Date" column found. The file needs a header row with a date, a description and an amount.' };
  const header = table[headerIdx].map((h) => h.trim().toLowerCase());
  const iDate = find(header, /^(transaction |trans\.? |posted |posting )?date$/, /date/);
  const iDesc = find(header, /^(description|merchant|payee|name)$/, /description|merchant|payee|name|memo|details/);
  const iAmount = find(header, /^amount$/, /amount/);
  const iDebit = find(header, /debit|withdrawal|money out/);
  const iCredit = find(header, /credit|deposit|money in/);
  const iCat = find(header, /^category$/, /category/);
  if (iDesc < 0) return { rows: [], skipped: 0, chargesPositive: false, error: 'No description or merchant column found.' };
  if (iAmount < 0 && iDebit < 0 && iCredit < 0) return { rows: [], skipped: 0, chargesPositive: false, error: 'No amount column found.' };

  const rows: CsvRow[] = [];
  let skipped = 0;
  for (const r of table.slice(headerIdx + 1)) {
    const date = parseDate(r[iDate] ?? '');
    let amount: number | null = null;
    if (iAmount >= 0) amount = parseAmount(r[iAmount] ?? '');
    if (amount === null && (iDebit >= 0 || iCredit >= 0)) {
      const debit = iDebit >= 0 ? parseAmount(r[iDebit] ?? '') : null;
      const credit = iCredit >= 0 ? parseAmount(r[iCredit] ?? '') : null;
      if (debit !== null || credit !== null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    const merchant = (r[iDesc] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || amount === null || amount === 0 || !merchant) {
      skipped++;
      continue;
    }
    rows.push({ date, merchant, amount, category: iCat >= 0 ? r[iCat]?.trim() || undefined : undefined });
  }
  const positive = rows.filter((r) => r.amount > 0).length;
  const chargesPositive = iAmount >= 0 && rows.length >= 4 && positive / rows.length > 0.7;
  return { rows, skipped, chargesPositive };
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n');
}
