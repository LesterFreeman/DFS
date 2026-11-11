import { describe, expect, it } from 'vitest';
import { allocation, baseline, flow, netWorthSeries, recurringCharges, spendByCategory, totals, txInMonth } from '../src/lib/analytics';
import { guessCategory } from '../src/lib/categories';
import { deriveKey, open, openWithPasscode, seal } from '../src/lib/crypto';
import { parseAmount, parseDate, readTransactionsCsv } from '../src/lib/csv';
import { addMonths, monthsEnding } from '../src/lib/dates';
import { demoData, emptyData } from '../src/lib/demo';
import { goalStatus } from '../src/lib/goals';
import { generateInsights } from '../src/lib/insights';
import { project, requiredMonthly } from '../src/lib/projection';
import type { AppData, Transaction } from '../src/lib/types';

const TODAY = '2026-11-11';
let n = 0;
const tx = (date: string, amount: number, merchant: string, categoryId: string): Transaction => ({ id: `t${n++}`, date, amount, merchant, categoryId });

describe('dates', () => {
  it('steps across year ends', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsEnding('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('spending', () => {
  const data = emptyData();
  data.transactions = [
    tx('2026-11-02', -50, 'Market', 'groceries'),
    tx('2026-11-03', -30, 'Cafe', 'dining'),
    tx('2026-11-04', 10, 'Cafe', 'dining'), // refund
    tx('2026-11-05', -500, 'Card payment', 'transfer'),
    tx('2026-11-06', 3000, 'Payroll', 'paycheck'),
    tx('2026-10-06', -999, 'Old', 'shopping'),
  ];
  it('groups by category, nets refunds, ignores transfers and income', () => {
    const rows = spendByCategory(data, txInMonth(data, '2026-11'));
    expect(rows.map((r) => [r.category.id, r.total])).toEqual([
      ['groceries', 50],
      ['dining', 20],
    ]);
  });
  it('computes cash flow', () => {
    expect(flow(data, txInMonth(data, '2026-11'))).toEqual({ income: 3000, spend: 70, net: 2930 });
  });
});

describe('net worth', () => {
  it('subtracts liabilities and ends the history with today', () => {
    const data = demoData(TODAY);
    const t = totals(data.accounts);
    expect(t.net).toBe(t.assets - t.liabilities);
    const series = netWorthSeries(data, TODAY);
    expect(series.at(-1)).toMatchObject({ date: TODAY, net: t.net });
    expect(series.length).toBeGreaterThan(12);
    expect(series.map((p) => p.date)).toEqual([...series.map((p) => p.date)].sort());
  });
  it('blends asset mixes by balance', () => {
    const data = emptyData();
    data.accounts = [
      { id: 'a', name: 'A', type: 'investment', balance: 1000, mix: { us_stocks: 100 }, updatedAt: TODAY },
      { id: 'b', name: 'B', type: 'retirement', balance: 3000, mix: { bonds: 50, us_stocks: 50 }, updatedAt: TODAY },
      { id: 'c', name: 'C', type: 'cash', balance: 9999, updatedAt: TODAY },
    ];
    const { total, slices } = allocation(data.accounts);
    expect(total).toBe(4000);
    expect(slices.find((s) => s.cls === 'us_stocks')!.share).toBeCloseTo(62.5);
    expect(slices.find((s) => s.cls === 'bonds')!.share).toBeCloseTo(37.5);
  });
});

describe('recurring charges', () => {
  it('finds same-price monthly charges and skips habits', () => {
    const data = emptyData();
    for (const m of ['08', '09', '10', '11']) {
      data.transactions.push(tx(`2026-${m}-02`, -15.49, 'Streamly', 'subscriptions'));
      data.transactions.push(tx(`2026-${m}-05`, -(20 + Number(m) * 7), 'Cafe', 'dining'));
    }
    const found = recurringCharges(data, TODAY);
    expect(found.map((r) => r.merchant)).toEqual(['Streamly']);
    expect(found[0].monthly).toBeCloseTo(15.49);
  });
});

describe('projection', () => {
  const plan = { ...emptyData().plan };
  const input = { age: 35, investable: 100000, homeEquity: 0, plan };
  it('is deterministic and ordered', () => {
    const a = project(input);
    const b = project(input);
    expect(a.atRetire).toEqual(b.atRetire);
    for (const y of a.years) {
      expect(y.p10).toBeLessThanOrEqual(y.p50);
      expect(y.p50).toBeLessThanOrEqual(y.p90);
    }
    expect(a.years[0].p50).toBe(100000);
    expect(a.years.at(-1)!.age).toBe(95);
  });
  it('matches compound growth when there is no volatility', () => {
    const flat = project({ ...input, plan: { ...plan, volatilityPct: 0, monthlyInvest: 0, inflationPct: 0, returnPct: 5 } });
    expect(flat.atRetire.p50).toBeCloseTo(100000 * 1.05 ** 30, 0);
    expect(flat.atRetire.p10).toBeCloseTo(flat.atRetire.p90, 0);
  });
  it('investing more helps, retiring on more hurts', () => {
    const base = project(input);
    expect(project({ ...input, plan: { ...plan, monthlyInvest: 2000 } }).atRetire.p50).toBeGreaterThan(base.atRetire.p50);
    expect(project({ ...input, plan: { ...plan, retireSpend: 12000 } }).success).toBeLessThan(base.success + 1e-9);
  });
  it('reports the FI number and finds a monthly amount that reaches the target', () => {
    const poor = { ...input, investable: 5000, plan: { ...plan, monthlyInvest: 100 } };
    const r = project(poor);
    expect(r.fiNumber).toBe((plan.retireSpend - plan.retireIncome) * 12 * 25);
    expect(r.success).toBeLessThan(0.5);
    const needed = requiredMonthly(poor, 0.85)!;
    expect(needed).toBeGreaterThan(100);
    expect(project({ ...poor, paths: 250, plan: { ...poor.plan, monthlyInvest: needed } }).success).toBeGreaterThanOrEqual(0.85);
  });
  it('adds home equity on top without spending it', () => {
    const withHome = project({ ...input, homeEquity: 50000 });
    expect(withHome.years[0].p50).toBe(150000);
    expect(withHome.success).toBe(project(input).success);
  });
});

describe('goals', () => {
  it('measures payoff goals from the starting balance', () => {
    const data = demoData(TODAY);
    const auto = goalStatus(data, data.goals.find((g) => g.id === 'g3')!, TODAY);
    expect(auto.total).toBe(17400);
    expect(auto.done).toBe(17400 - 9300);
    expect(auto.pace).toBeGreaterThan(300);
  });
});

describe('recommendations', () => {
  const ids = (d: AppData) => generateInsights(d, TODAY).map((i) => i.id);
  it('asks for setup when empty', () => {
    expect(ids(emptyData())).toEqual(['setup-accounts', 'setup-transactions']);
  });
  it('finds the problems planted in the sample household', () => {
    const data = demoData(TODAY);
    const found = generateInsights(data, TODAY);
    const got = found.map((i) => i.id);
    expect(got).toContain('high-interest-debt');
    expect(got).toContain('spike-dining');
    expect(got).toContain('recurring');
    expect(got).toContain('fees');
    expect(got).toContain('stale-balances');
    // Actions come before things to watch, which come before wins.
    const tones = found.map((i) => i.tone);
    expect(tones).toEqual([...tones].sort((a, b) => 'action watch win'.indexOf(a) - 'action watch win'.indexOf(b)));
    expect(found[0].tone).toBe('action');
  });
  it('flags a thin emergency fund and overspending', () => {
    const data = emptyData();
    data.accounts = [{ id: 'c', name: 'Checking', type: 'cash', balance: 1500, updatedAt: TODAY }];
    for (const m of ['09', '10', '11']) {
      data.transactions.push(tx(`2026-${m}-01`, -2000, 'Rent', 'housing'), tx(`2026-${m}-03`, 2500, 'Payroll', 'paycheck'), tx(`2026-${m}-05`, -900, 'Shop', 'shopping'));
    }
    data.transactions.push(tx('2026-08-20', -1, 'x', 'other'));
    const got = ids(data);
    expect(got).toContain('emergency-fund');
    expect(got).toContain('savings-rate');
    expect(baseline(data, TODAY)!.monthlyEssential).toBeGreaterThan(1900);
  });
  it('hides a dismissed recommendation for the rest of the month', () => {
    const data = demoData(TODAY);
    data.dismissed['recurring'] = '2026-11';
    expect(ids(data)).not.toContain('recurring');
    data.dismissed['recurring'] = '2026-10';
    expect(ids(data)).toContain('recurring');
  });
  it('flags a blown budget', () => {
    const data = emptyData();
    data.categories.find((c) => c.id === 'dining')!.budget = 100;
    data.transactions.push(tx('2026-11-03', -140, 'Cafe', 'dining'));
    expect(ids(data)).toContain('budget-dining');
  });
});

describe('csv import', () => {
  it('parses amounts and dates in common formats', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(45.00)')).toBe(-45);
    expect(parseAmount('-12')).toBe(-12);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseDate('2026-03-09')).toBe('2026-03-09');
    expect(parseDate('3/9/26')).toBe('2026-03-09');
    expect(parseDate('25/12/2026')).toBe('2026-12-25');
    expect(parseDate('nope')).toBeNull();
  });
  it('reads a bank export with quoted fields and preamble', () => {
    const csv = 'Account,1234\n\nDate,Description,Amount,Category\n11/02/2026,"COFFEE, DAILY GRIND",-4.50,Dining\n11/03/2026,PAYROLL,"2,500.00",\nbad,row,x\n';
    const r = readTransactionsCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.skipped).toBe(1);
    expect(r.rows).toEqual([
      { date: '2026-11-02', merchant: 'COFFEE, DAILY GRIND', amount: -4.5, category: 'Dining' },
      { date: '2026-11-03', merchant: 'PAYROLL', amount: 2500, category: undefined },
    ]);
  });
  it('handles debit and credit columns and spots card-style signs', () => {
    const r = readTransactionsCsv('Posted Date,Payee,Debit,Credit\n2026-11-01,Market,25.10,\n2026-11-02,Refund,,5.00\n');
    expect(r.rows.map((x) => x.amount)).toEqual([-25.1, 5]);
    const card = readTransactionsCsv('Date,Description,Amount\n' + [1, 2, 3, 4, 5].map((d) => `2026-11-0${d},Shop,${d}0.00`).join('\n'));
    expect(card.chargesPositive).toBe(true);
  });
  it('guesses categories and honours learned rules', () => {
    expect(guessCategory('TRADER JOE S #552', -40)).toBe('groceries');
    expect(guessCategory('Daily Grind Coffee', -4)).toBe('dining');
    expect(guessCategory('Current Electric', -4)).toBe('utilities');
    expect(guessCategory('ACME PAYROLL', 2000)).toBe('paycheck');
    expect(guessCategory('Mystery', -4)).toBe('other');
    expect(guessCategory('Mystery', -4, { mystery: 'gifts' })).toBe('gifts');
  });
});

describe('encryption', () => {
  it('round-trips with the right passcode and refuses the wrong one', async () => {
    const key = await deriveKey('correct horse', undefined, 1000);
    const sealed = await seal({ secret: 42 }, key);
    expect(sealed.ct).not.toContain('secret');
    expect(await open(sealed, key)).toEqual({ secret: 42 });
    expect((await openWithPasscode<{ secret: number }>(sealed, 'correct horse')).value.secret).toBe(42);
    await expect(openWithPasscode(sealed, 'wrong')).rejects.toThrow();
  });
});
