import { makeSnapshot } from './analytics';
import { DEFAULT_CATEGORIES } from './categories';
import { addDays, addMonths, daysInMonth, monthOf } from './dates';
import type { Account, AppData, Snapshot, Transaction } from './types';

export const DEFAULT_PLAN = {
  monthlyInvest: 500,
  returnPct: 7,
  volatilityPct: 13,
  inflationPct: 2.5,
  raisePct: 1,
  retireAge: 65,
  retireSpend: 5000,
  retireIncome: 1500,
  includeHome: false,
};

export function emptyData(): AppData {
  return {
    version: 1,
    profile: { name: '', age: 35, currency: 'USD' },
    accounts: [],
    snapshots: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    transactions: [],
    goals: [],
    plan: { ...DEFAULT_PLAN },
    merchantRules: {},
    dismissed: {},
  };
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up household so the app can be explored before entering anything real. */
export function demoData(today: string): AppData {
  const rand = rng(7);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const data = emptyData();
  data.profile = { name: 'Sam', age: 34, currency: 'USD' };
  data.plan = { ...DEFAULT_PLAN, monthlyInvest: 900, retireSpend: 5500, retireIncome: 1800 };

  const acct = (id: string, name: string, type: Account['type'], balance: number, extra: Partial<Account> = {}): Account => ({
    id,
    name,
    type,
    balance,
    updatedAt: today,
    ...extra,
  });
  data.accounts = [
    acct('chk', 'Everyday Checking', 'cash', 4180, { institution: 'First Harbor', rate: 0.1 }),
    acct('sav', 'High-Yield Savings', 'cash', 15400, { institution: 'Northlight', rate: 4.1 }),
    acct('brk', 'Brokerage', 'investment', 38250, { institution: 'Meridian', mix: { us_stocks: 80, intl_stocks: 15, cash: 5 } }),
    acct('k401', '401(k)', 'retirement', 96400, { institution: 'Meridian', mix: { us_stocks: 65, intl_stocks: 25, bonds: 10 } }),
    acct('roth', 'Roth IRA', 'retirement', 31800, { institution: 'Meridian', mix: { us_stocks: 70, intl_stocks: 30 } }),
    acct('car', 'Car', 'other_asset', 14500, { updatedAt: addDays(today, -48) }),
    acct('visa', 'Rewards Visa', 'credit', 3860, { institution: 'First Harbor', rate: 24.9 }),
    acct('auto', 'Auto Loan', 'loan', 9300, { institution: 'Northlight', rate: 6.4 }),
    acct('stu', 'Student Loan', 'loan', 13900, { rate: 5.5 }),
  ];

  // Balance history: walk backwards month by month from today's balances.
  const drift: Record<string, [number, number]> = {
    // [typical monthly change, noise]
    chk: [40, 700],
    sav: [310, 120],
    brk: [520, 1300],
    k401: [1650, 2900],
    roth: [540, 1000],
    car: [-190, 0],
    visa: [-45, 90],
    auto: [-355, 0],
    stu: [-210, 0],
  };
  const snaps: Snapshot[] = [];
  const balances = Object.fromEntries(data.accounts.map((a) => [a.id, a.balance]));
  const thisMonth = monthOf(today);
  for (let i = 0; i < 24; i++) {
    const month = addMonths(thisMonth, -i);
    if (i > 0) {
      for (const a of data.accounts) {
        const [step, noise] = drift[a.id];
        balances[a.id] = Math.max(0, Math.round(balances[a.id] - step + between(-noise, noise)));
      }
      const past = data.accounts.map((a) => ({ ...a, balance: balances[a.id] }));
      snaps.push(makeSnapshot(past, `${month}-${String(Math.min(28, daysInMonth(month))).padStart(2, '0')}`));
    }
  }
  data.snapshots = snaps.reverse();

  // Transactions: 13 months.
  const txs: Transaction[] = [];
  let n = 0;
  const tx = (date: string, amount: number, merchant: string, categoryId: string, accountId = 'visa') => {
    if (date > today) return;
    txs.push({ id: `d${n++}`, date, amount: Math.round(amount * 100) / 100, merchant, categoryId, accountId });
  };
  const day = (month: string, d: number) => `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, '0')}`;
  const groceries = ['Greenleaf Market', 'Corner Co-op', 'Harvest Grocers', 'Bulk Barn Warehouse'];
  const dining = ['Luna Taqueria', 'Blue Door Cafe', 'Noodle House', 'Slice Society', 'The Copper Pot', 'Daily Grind Coffee', 'Sakura Sushi', 'Tap & Barrel'];
  const shops = ['Parcel & Co', 'Northside Outfitters', 'Maple Home Goods', 'Circuit Electronics', 'Paper Lantern Books'];
  const recentFrom = addDays(today, -30);

  for (let i = 12; i >= 0; i--) {
    const m = addMonths(thisMonth, -i);
    tx(day(m, 15), 3450, 'Brightwave Payroll', 'paycheck', 'chk');
    tx(day(m, 1), 3450, 'Brightwave Payroll', 'paycheck', 'chk');
    tx(day(m, 1), -2150, 'Cedar Court Apartments', 'housing', 'chk');
    tx(day(m, 4), -between(78, 132), 'City Power & Light', 'utilities', 'chk');
    tx(day(m, 6), -70, 'FiberLink Internet', 'utilities', 'chk');
    tx(day(m, 9), -65, 'Signal Mobile', 'utilities', 'chk');
    tx(day(m, 12), -128.4, 'Shoreline Auto Insurance', 'insurance', 'chk');
    tx(day(m, 18), -355, 'Auto Loan Payment', 'transfer', 'chk');
    tx(day(m, 20), -260, 'Student Loan Payment', 'transfer', 'chk');
    tx(day(m, 22), -600, 'Rewards Visa Payment', 'transfer', 'chk');
    tx(day(m, 2), -15.49, 'Streamly', 'subscriptions');
    tx(day(m, 5), -11.99, 'Tunebox Music', 'subscriptions');
    tx(day(m, 7), -2.99, 'Cloud Storage', 'subscriptions');
    tx(day(m, 10), -45, 'Ironworks Gym', 'subscriptions');
    tx(day(m, 14), -17, 'The Daily Ledger', 'subscriptions');
    if (i < 7) tx(day(m, 21), -22.99, 'Chef Box Meal Kit', 'subscriptions');
    tx(day(m, 25), -between(68, 84), 'Interest Charge', 'fees');
    for (let k = 0; k < 7; k++) tx(day(m, 2 + k * 4), -between(48, 135), pick(groceries), 'groceries');
    for (let k = 0; k < 3; k++) tx(day(m, 5 + k * 9), -between(38, 58), 'Summit Fuel', 'transport');
    if (rand() < 0.6) tx(day(m, 17), -between(14, 38), 'Hail Rideshare', 'transport');
    for (let k = 0; k < 10; k++) {
      const date = day(m, 1 + Math.floor(rand() * 28));
      // Restaurant spending has crept up recently, which the recommendations should notice.
      const bump = date > recentFrom ? 1.5 : 1;
      tx(date, -between(11, 62) * bump, pick(dining), 'dining');
    }
    for (let k = 0; k < 3; k++) tx(day(m, 3 + Math.floor(rand() * 25)), -between(18, 140), pick(shops), 'shopping');
    if (rand() < 0.7) tx(day(m, 8 + Math.floor(rand() * 15)), -between(18, 65), pick(['Rialto Cinema', 'Arcade Alley', 'City Museum']), 'entertainment');
    if (rand() < 0.45) tx(day(m, 11), -between(25, 140), pick(['Wellspring Pharmacy', 'Parkside Dental']), 'health');
    if (rand() < 0.3) tx(day(m, 19), -between(28, 70), 'Fringe Salon', 'personal');
    if (i % 5 === 2) {
      tx(day(m, 13), -between(310, 520), 'Skyway Airlines', 'travel');
      tx(day(m, 16), -between(240, 420), 'Harborview Hotel', 'travel');
    }
    if (i % 6 === 4) tx(day(m, 23), -between(40, 120), 'Gift Shop', 'gifts');
  }
  data.transactions = txs.sort((a, b) => b.date.localeCompare(a.date));

  const budget = (id: string, amount: number) => {
    const c = data.categories.find((x) => x.id === id);
    if (c) c.budget = amount;
  };
  budget('groceries', 650);
  budget('dining', 380);
  budget('shopping', 300);
  budget('subscriptions', 100);

  data.goals = [
    { id: 'g1', name: 'House down payment', icon: '🏡', kind: 'save', target: 60000, targetDate: addMonths(thisMonth, 30) + '-01', accountIds: ['sav'], startAmount: 9000, createdAt: addDays(today, -400) },
    { id: 'g2', name: 'Pay off Rewards Visa', icon: '💳', kind: 'payoff', target: 0, targetDate: addMonths(thisMonth, 12) + '-01', accountIds: ['visa'], startAmount: 3860, createdAt: addDays(today, -60) },
    { id: 'g3', name: 'Pay off auto loan', icon: '🚗', kind: 'payoff', target: 0, targetDate: addMonths(thisMonth, 27) + '-01', accountIds: ['auto'], startAmount: 17400, createdAt: addDays(today, -700) },
  ];
  return data;
}
