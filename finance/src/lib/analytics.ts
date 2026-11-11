import { addDays, addMonths, daysBetween, monthOf, monthsEnding } from './dates';
import type { Account, AppData, AssetClass, Category, Snapshot, Transaction } from './types';
import { ASSET_CLASSES, isLiability } from './types';

export const catMap = (data: AppData) => new Map(data.categories.map((c) => [c.id, c]));

/** Spending counts everything that is not income and not a transfer. Refunds reduce it. */
export function isSpendCat(c: Category | undefined): boolean {
  return !c || c.group === 'essential' || c.group === 'lifestyle';
}

export interface CategorySpend {
  category: Category;
  total: number;
  count: number;
}

const FALLBACK: Category = { id: 'other', name: 'Everything else', icon: '📦', group: 'lifestyle' };

export function spendByCategory(data: AppData, txs: Transaction[]): CategorySpend[] {
  const cats = catMap(data);
  const acc = new Map<string, CategorySpend>();
  for (const t of txs) {
    const c = cats.get(t.categoryId) ?? FALLBACK;
    if (!isSpendCat(c)) continue;
    const row = acc.get(c.id) ?? { category: c, total: 0, count: 0 };
    row.total -= t.amount;
    row.count += 1;
    acc.set(c.id, row);
  }
  return [...acc.values()].filter((r) => r.total > 0.005).sort((a, b) => b.total - a.total);
}

export interface Flow {
  income: number;
  spend: number;
  net: number;
}

export function flow(data: AppData, txs: Transaction[]): Flow {
  const cats = catMap(data);
  let income = 0;
  let spend = 0;
  for (const t of txs) {
    const c = cats.get(t.categoryId);
    if (c?.group === 'income') income += t.amount;
    else if (isSpendCat(c)) spend -= t.amount;
  }
  return { income, spend, net: income - spend };
}

export const txInMonth = (data: AppData, month: string) => data.transactions.filter((t) => monthOf(t.date) === month);

/** Transactions after `from` up to and including `to`. */
export const txBetween = (data: AppData, from: string, to: string) =>
  data.transactions.filter((t) => t.date > from && t.date <= to);

export function monthlyFlows(data: AppData, endMonth: string, n: number): { month: string; flow: Flow }[] {
  return monthsEnding(endMonth, n).map((month) => ({ month, flow: flow(data, txInMonth(data, month)) }));
}

/** How many days of transaction history there are up to `today` (0 when none). */
export function historyDays(data: AppData, today: string): number {
  let first = '';
  for (const t of data.transactions) if (!first || t.date < first) first = t.date;
  return first ? Math.max(0, daysBetween(first, today)) : 0;
}

export interface Baseline {
  /** Days of history the averages cover (at most 90). */
  days: number;
  monthlySpend: number;
  monthlyEssential: number;
  monthlyIncome: number;
}

/** Average monthly figures over the last 90 days (or however much history exists, minimum 14 days). */
export function baseline(data: AppData, today: string): Baseline | null {
  const days = Math.min(90, historyDays(data, today));
  if (days < 14) return null;
  const txs = txBetween(data, addDays(today, -days), today);
  const cats = catMap(data);
  const scale = 30.44 / days;
  const f = flow(data, txs);
  let essential = 0;
  for (const t of txs) if (cats.get(t.categoryId)?.group === 'essential') essential -= t.amount;
  return {
    days,
    monthlySpend: f.spend * scale,
    monthlyEssential: Math.max(0, essential) * scale,
    monthlyIncome: f.income * scale,
  };
}

// ---- Net worth ----

export interface Totals {
  assets: number;
  liabilities: number;
  net: number;
}

export function totals(accounts: Account[]): Totals {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (isLiability(a.type)) liabilities += a.balance;
    else assets += a.balance;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export const sumType = (accounts: Account[], ...types: Account['type'][]) =>
  accounts.filter((a) => types.includes(a.type)).reduce((s, a) => s + a.balance, 0);

export function makeSnapshot(accounts: Account[], date: string): Snapshot {
  const t = totals(accounts);
  return {
    date,
    assets: t.assets,
    liabilities: t.liabilities,
    balances: Object.fromEntries(accounts.map((a) => [a.id, a.balance])),
  };
}

export interface NetPoint {
  date: string;
  assets: number;
  liabilities: number;
  net: number;
}

/** History from snapshots, ending with the balances as they are today. */
export function netWorthSeries(data: AppData, today: string): NetPoint[] {
  const pts = data.snapshots
    .filter((s) => s.date < today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, assets: s.assets, liabilities: s.liabilities, net: s.assets - s.liabilities }));
  if (data.accounts.length) {
    const t = totals(data.accounts);
    pts.push({ date: today, ...t });
  }
  return pts;
}

/** The last point on or before `date`, if any. */
export function pointAt(series: NetPoint[], date: string): NetPoint | undefined {
  let hit: NetPoint | undefined;
  for (const p of series) if (p.date <= date) hit = p;
  return hit;
}

/** Sum of the given accounts' balances at each snapshot date, plus today. */
export function accountsSeries(data: AppData, ids: string[], today: string): { date: string; value: number }[] {
  const pts = data.snapshots
    .filter((s) => s.date < today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, value: ids.reduce((sum, id) => sum + (s.balances[id] ?? 0), 0) }));
  const now = data.accounts.filter((a) => ids.includes(a.id)).reduce((s, a) => s + a.balance, 0);
  pts.push({ date: today, value: now });
  return pts;
}

// ---- Allocation ----

export interface Slice {
  cls: AssetClass;
  value: number;
  share: number;
}

/** Asset mix across investment and retirement accounts. Accounts without a mix count as "other". */
export function allocation(accounts: Account[]): { total: number; slices: Slice[] } {
  const sums = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>;
  let total = 0;
  for (const a of accounts) {
    if (a.type !== 'investment' && a.type !== 'retirement') continue;
    total += a.balance;
    const mix = a.mix && Object.keys(a.mix).length ? a.mix : { other: 100 };
    const mixTotal = Object.values(mix).reduce((s, v) => s + (v || 0), 0) || 100;
    for (const c of ASSET_CLASSES) sums[c] += (a.balance * (mix[c] || 0)) / mixTotal;
  }
  const slices = ASSET_CLASSES.map((cls) => ({ cls, value: sums[cls], share: total ? (sums[cls] / total) * 100 : 0 })).filter(
    (s) => s.value > 0.5,
  );
  return { total, slices };
}

// ---- Recurring charges ----

export interface Recurring {
  merchant: string;
  categoryId: string;
  /** Typical charge. */
  amount: number;
  /** Charges seen in the window. */
  count: number;
  lastDate: string;
  monthly: number;
}

/**
 * Merchants that charged a similar amount in at least three different months of the last ~4 months,
 * at most once or twice a month. Rent-sized housing payments are left out: they are not something to trim.
 */
export function recurringCharges(data: AppData, today: string): Recurring[] {
  const from = addDays(today, -125);
  const cats = catMap(data);
  const groups = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (t.date <= from || t.date > today || t.amount >= 0) continue;
    const c = cats.get(t.categoryId);
    if (!isSpendCat(c) || c?.id === 'housing') continue;
    const key = t.merchant.trim().toLowerCase();
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  const out: Recurring[] = [];
  for (const g of groups.values()) {
    const months = new Set(g.map((t) => monthOf(t.date)));
    if (months.size < 3 || g.length > months.size * 2) continue;
    const amounts = g.map((t) => -t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    // Same price each time (within 15%), which is what separates a subscription from a habit.
    if (amounts.some((a) => Math.abs(a - median) > Math.max(1, median * 0.15))) continue;
    const last = g.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({
      merchant: last.merchant,
      categoryId: last.categoryId,
      amount: median,
      count: g.length,
      lastDate: last.date,
      monthly: (median * g.length) / months.size,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export const prevMonth = (m: string) => addMonths(m, -1);
