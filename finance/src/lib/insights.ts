import {
  allocation,
  baseline,
  catMap,
  flow,
  historyDays,
  isSpendCat,
  netWorthSeries,
  pointAt,
  recurringCharges,
  spendByCategory,
  sumType,
  txBetween,
  txInMonth,
} from './analytics';
import { addDays, addMonths, dayLabel, daysBetween, daysInMonth, monthOf } from './dates';
import { money, moneyCents } from './format';
import { goalStatus } from './goals';
import { project, requiredMonthly } from './projection';
import type { AppData } from './types';
import { isLiability } from './types';

export type Tone = 'action' | 'watch' | 'win';
export type Area = 'Spending' | 'Saving' | 'Debt' | 'Investing' | 'Goals' | 'Upkeep';

export interface Insight {
  id: string;
  tone: Tone;
  area: Area;
  title: string;
  body: string;
  /** Short figure shown on the card, e.g. "$1,240 / yr". */
  figure?: string;
  /** Concrete next steps. */
  steps?: string[];
  /** Rough yearly value in money, used only for ordering. */
  weight: number;
}

/** Investable money for the projection: liquid assets minus non-mortgage debt. */
export function investableNow(data: AppData): number {
  return sumType(data.accounts, 'cash', 'investment', 'retirement') - sumType(data.accounts, 'credit', 'loan');
}
export const homeEquityNow = (data: AppData) =>
  Math.max(0, sumType(data.accounts, 'property') - sumType(data.accounts, 'mortgage'));

export function projectionInput(data: AppData) {
  return {
    age: data.profile.age,
    investable: investableNow(data),
    homeEquity: data.plan.includeHome ? homeEquityNow(data) : 0,
    plan: data.plan,
  };
}

const HIGH_RATE = 8;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const months = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

export function generateInsights(data: AppData, today: string): Insight[] {
  const out: Insight[] = [];
  const add = (i: Insight) => out.push(i);
  const month = monthOf(today);
  const cats = catMap(data);
  const base = baseline(data, today);
  const cash = sumType(data.accounts, 'cash');
  const debts = data.accounts.filter((a) => isLiability(a.type) && a.balance > 0);
  const costly = debts.filter((a) => (a.rate ?? 0) >= HIGH_RATE).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  // ---- Getting started ----
  if (!data.accounts.length) {
    add({
      id: 'setup-accounts',
      tone: 'action',
      area: 'Upkeep',
      title: 'Add your accounts',
      body: 'Enter what you own and what you owe to see your net worth. Balances stay on this device.',
      weight: 1e9,
    });
  }
  if (!data.transactions.length) {
    add({
      id: 'setup-transactions',
      tone: 'action',
      area: 'Upkeep',
      title: 'Bring in your transactions',
      body: 'Import a CSV export from your bank or card, or add transactions by hand. Spending recommendations start after about two weeks of history.',
      weight: 1e9 - 1,
    });
  }

  // ---- Emergency fund ----
  const need = base ? (base.monthlyEssential > 0 ? base.monthlyEssential : base.monthlySpend) : 0;
  if (base && need > 0 && data.accounts.length) {
    const cover = cash / need;
    if (cover < 3) {
      const gap = need * 3 - cash;
      add({
        id: 'emergency-fund',
        tone: 'action',
        area: 'Saving',
        title: cover < 1 ? 'Start an emergency fund' : 'Top up your emergency fund',
        body: `You hold ${money(cash)} in cash, about ${months(cover)} months of essentials (${money(need)} a month). Three to six months is the usual cushion, so the first target is ${money(need * 3)}.`,
        figure: `${money(gap)} to go`,
        steps: [
          `Set aside ${money(gap / 12)} a month to reach three months within a year.`,
          'Keep it in a savings account you can reach within a day.',
        ],
        weight: gap,
      });
    } else if (cover <= 6.5) {
      add({
        id: 'emergency-fund-ok',
        tone: 'win',
        area: 'Saving',
        title: 'Emergency fund is covered',
        body: `${money(cash)} in cash covers about ${months(cover)} months of essentials.`,
        weight: 0,
      });
    }
  }

  // ---- High-interest debt ----
  if (costly.length) {
    const interest = costly.reduce((s, a) => s + (a.balance * (a.rate ?? 0)) / 100, 0);
    const owed = costly.reduce((s, a) => s + a.balance, 0);
    const spare = base ? cash - need * 3 : 0;
    const steps = costly.slice(0, 4).map((a, i) => `${i + 1}. ${a.name}: ${money(a.balance)} at ${a.rate}%`);
    if (spare > 500) {
      steps.push(`You have about ${money(spare)} in cash beyond three months of essentials. Putting ${money(Math.min(spare, owed))} toward this is a guaranteed ${costly[0].rate}% return.`);
    }
    add({
      id: 'high-interest-debt',
      tone: 'action',
      area: 'Debt',
      title: costly.length === 1 ? `Pay down ${costly[0].name}` : 'Pay down high-interest debt',
      body: `${money(owed)} of debt at ${HIGH_RATE}% or more costs you about ${money(interest)} a year in interest. Pay the minimum on everything, then send every spare dollar to the highest rate first.`,
      figure: `${money(interest)} / yr in interest`,
      steps,
      weight: interest * 3,
    });
  }

  // ---- Savings rate ----
  if (base && base.monthlyIncome > 0) {
    const saved = base.monthlyIncome - base.monthlySpend;
    const rate = (saved / base.monthlyIncome) * 100;
    const top = spendByCategory(data, txBetween(data, addDays(today, -base.days), today))
      .filter((r) => r.category.group === 'lifestyle')
      .slice(0, 2)
      .map((r) => `${r.category.name} (${money((r.total / base.days) * 30.44)} a month)`);
    const where = top.length ? ` Your largest flexible categories are ${top.join(' and ')}.` : '';
    if (rate < 0) {
      add({
        id: 'savings-rate',
        tone: 'action',
        area: 'Saving',
        title: 'Spending is running ahead of income',
        body: `Over the last ${base.days} days you spent about ${money(-saved)} a month more than you brought in.${where}`,
        figure: `${money(-saved)} / mo short`,
        weight: -saved * 12,
      });
    } else if (rate < 20) {
      const lift = base.monthlyIncome * 0.2 - saved;
      add({
        id: 'savings-rate',
        tone: rate < 10 ? 'action' : 'watch',
        area: 'Saving',
        title: `You keep ${rate.toFixed(0)}% of your income`,
        body: `That is ${money(saved)} a month out of ${money(base.monthlyIncome)}. Reaching 20% means freeing up another ${money(lift)} a month.${where}`,
        figure: `${money(lift)} / mo to reach 20%`,
        weight: lift * 12,
      });
    } else {
      add({
        id: 'savings-rate-ok',
        tone: 'win',
        area: 'Saving',
        title: `You keep ${rate.toFixed(0)}% of your income`,
        body: `About ${money(saved)} a month stays with you. Make sure it is going somewhere on purpose: investments, a goal, or debt.`,
        weight: 0,
      });
    }
  }

  // ---- Categories running above their usual level ----
  if (historyDays(data, today) >= 75) {
    const recent = spendByCategory(data, txBetween(data, addDays(today, -30), today));
    const prior = new Map(
      spendByCategory(data, txBetween(data, addDays(today, -120), addDays(today, -30))).map((r) => [r.category.id, r.total / 3]),
    );
    recent
      .map((r) => ({ r, usual: prior.get(r.category.id) ?? 0 }))
      .filter(({ r, usual }) => usual > 0 && r.total > usual * 1.3 && r.total - usual >= 60)
      .sort((a, b) => b.r.total - b.usual - (a.r.total - a.usual))
      .slice(0, 3)
      .forEach(({ r, usual }) => {
        const over = r.total - usual;
        const biggest = txBetween(data, addDays(today, -30), today)
          .filter((t) => t.categoryId === r.category.id && t.amount < 0)
          .sort((a, b) => a.amount - b.amount)
          .slice(0, 3)
          .map((t) => `${t.merchant}: ${money(-t.amount)} on ${dayLabel(t.date)}`);
        add({
          id: `spike-${r.category.id}`,
          tone: 'watch',
          area: 'Spending',
          title: `${r.category.name} is up ${((over / usual) * 100).toFixed(0)}%`,
          body: `${money(r.total)} in the last 30 days against a usual ${money(usual)} a month.`,
          figure: `${money(over)} over usual`,
          steps: biggest.length ? ['Largest charges:', ...biggest] : undefined,
          weight: over * 4,
        });
      });
  }

  // ---- Budgets ----
  const budgeted = data.categories.filter((c) => (c.budget ?? 0) > 0);
  if (budgeted.length) {
    const spentNow = new Map(spendByCategory(data, txInMonth(data, month)).map((r) => [r.category.id, r.total]));
    const day = Number(today.slice(8, 10));
    const dim = daysInMonth(month);
    const lastMonthTx = txInMonth(data, addMonths(month, -1));
    for (const c of budgeted) {
      const spent = spentNow.get(c.id) ?? 0;
      const budget = c.budget!;
      if (spent > budget) {
        add({
          id: `budget-${c.id}`,
          tone: 'action',
          area: 'Spending',
          title: `${c.name} is over budget`,
          body: `${money(spent)} spent of a ${money(budget)} budget with ${plural(dim - day, 'day')} left this month.`,
          figure: `${money(spent - budget)} over`,
          weight: (spent - budget) * 12,
        });
      } else if (day < dim) {
        // Bills cluster at particular times of the month, so the guide to what is still to come
        // is what was spent after this date last month, not a straight-line pace.
        const stillToCome = -lastMonthTx
          .filter((t) => t.categoryId === c.id && Number(t.date.slice(8, 10)) > day)
          .reduce((s, t) => s + t.amount, 0);
        if (stillToCome > 0 && spent + stillToCome > budget * 1.05) {
          add({
            id: `budget-${c.id}`,
            tone: 'watch',
            area: 'Spending',
            title: `${c.name} is on course to go over`,
            body: `${money(spent)} of ${money(budget)} is spent, and last month you spent another ${money(stillToCome)} after this date. Staying under means about ${money((budget - spent) / (dim - day))} a day from here.`,
            figure: `${money(budget - spent)} left`,
            weight: (spent + stillToCome - budget) * 6,
          });
        }
      }
    }
  } else if (base && historyDays(data, today) >= 45) {
    const top = spendByCategory(data, txBetween(data, addDays(today, -base.days), today))
      .filter((r) => r.category.group === 'lifestyle')
      .slice(0, 3);
    if (top.length) {
      add({
        id: 'set-budgets',
        tone: 'watch',
        area: 'Spending',
        title: 'Give your flexible spending a limit',
        body: 'You have no budgets yet. Starting with your biggest flexible categories, set about 10% under what you usually spend:',
        steps: top.map((r) => {
          const usual = (r.total / base.days) * 30.44;
          return `${r.category.name}: usually ${money(usual)}, try ${money(Math.floor((usual * 0.9) / 10) * 10)}`;
        }),
        weight: top.reduce((s, r) => s + (r.total / base.days) * 30.44 * 0.1 * 12, 0),
      });
    }
  }

  // ---- Recurring charges ----
  const recurring = recurringCharges(data, today).filter((r) => cats.get(r.categoryId)?.group !== 'essential' && r.categoryId !== 'fees');
  const recurringMonthly = recurring.reduce((s, r) => s + r.monthly, 0);
  if (recurring.length >= 3 || recurringMonthly >= 60) {
    add({
      id: 'recurring',
      tone: 'watch',
      area: 'Spending',
      title: `${plural(recurring.length, 'recurring charge')} add up to ${money(recurringMonthly * 12)} a year`,
      body: `That is ${money(recurringMonthly)} a month on repeat. Cancel anything you would not sign up for again today.`,
      figure: `${money(recurringMonthly)} / mo`,
      steps: recurring.slice(0, 6).map((r) => `${r.merchant}: ${moneyCents(r.amount)}`),
      weight: recurringMonthly * 12 * 0.25,
    });
  }

  // ---- Fees and interest ----
  const fees = -txBetween(data, addDays(today, -90), today)
    .filter((t) => t.categoryId === 'fees')
    .reduce((s, t) => s + t.amount, 0);
  if (fees >= 25) {
    add({
      id: 'fees',
      tone: 'watch',
      area: 'Spending',
      title: `${money(fees)} went to fees and interest`,
      body: 'That is the last 90 days. Fees are usually avoidable: ask for a waiver, switch to a no-fee account, or set up autopay to stop late charges.',
      figure: `${money(fees * 4)} / yr at this pace`,
      weight: fees * 4,
    });
  }

  // ---- Idle cash ----
  if (base && !costly.length && base.monthlySpend > 0) {
    const excess = cash - base.monthlySpend * 6;
    if (excess >= 2500) {
      const gain = (excess * Math.max(0, data.plan.returnPct - 2)) / 100;
      add({
        id: 'idle-cash',
        tone: 'watch',
        area: 'Investing',
        title: 'More cash than you need on hand',
        body: `${money(cash)} in cash is ${months(cash / base.monthlySpend)} months of spending. About ${money(excess)} sits beyond a six-month cushion. Unless it is earmarked for something soon, investing it at your plan's ${data.plan.returnPct}% expected return could add roughly ${money(gain)} a year over a typical savings rate.`,
        figure: `${money(excess)} idle`,
        weight: gain,
      });
    }
  }
  for (const a of data.accounts) {
    if (a.type === 'cash' && a.balance >= 5000 && a.rate !== undefined && a.rate < 2) {
      add({
        id: `low-yield-${a.id}`,
        tone: 'watch',
        area: 'Saving',
        title: `${a.name} earns only ${a.rate}%`,
        body: `${money(a.balance)} is sitting at ${a.rate}%. Every extra point of yield is worth ${money(a.balance / 100)} a year, so compare current high-yield savings rates.`,
        figure: `${money(a.balance / 100)} / yr per 1%`,
        weight: (a.balance / 100) * 2,
      });
    }
  }

  // ---- Retirement plan ----
  const input = projectionInput(data);
  if (data.accounts.length && data.profile.age < data.plan.retireAge && data.plan.retireSpend > 0) {
    const result = project({ ...input, paths: 300 });
    const chance = Math.round(result.success * 100);
    if (result.success < 0.9) {
      const needed = requiredMonthly(input, 0.85);
      const extra = needed !== null ? needed - data.plan.monthlyInvest : null;
      add({
        id: 'retirement',
        tone: result.success < 0.7 ? 'action' : 'watch',
        area: 'Investing',
        title: `Your plan lasts to 95 in ${chance}% of simulations`,
        body:
          `Retiring at ${data.plan.retireAge} on ${money(data.plan.retireSpend)} a month, investing ${money(data.plan.monthlyInvest)} a month until then.` +
          (extra !== null
            ? ` Raising that to ${money(needed!)} a month would lift the odds to about 85%.`
            : ' Investing more alone does not close the gap: try a later retirement age or lower retirement spending in the Plan tab.'),
        figure: extra !== null ? `+${money(extra)} / mo` : undefined,
        steps: ['Open the Plan tab to try a later retirement age, different spending, or a different amount.'],
        weight: (extra ?? 500) * 12,
      });
    } else {
      add({
        id: 'retirement-ok',
        tone: 'win',
        area: 'Investing',
        title: `Retirement plan holds in ${chance}% of simulations`,
        body: `Retiring at ${data.plan.retireAge} on ${money(data.plan.retireSpend)} a month looks well funded${result.fiAge ? `, and the middle path reaches financial independence around age ${result.fiAge}` : ''}.`,
        weight: 0,
      });
    }
  }

  // ---- Asset mix ----
  const alloc = allocation(data.accounts);
  if (alloc.total >= 1000) {
    const share = (c: string) => alloc.slices.find((s) => s.cls === c)?.share ?? 0;
    if (share('other') > 50) {
      add({
        id: 'set-mix',
        tone: 'watch',
        area: 'Upkeep',
        title: 'Tell Trove what your investments hold',
        body: 'Most of your invested money has no asset mix set. Open an investment account and set its split between stocks, bonds and cash to get allocation checks.',
        weight: 50,
      });
    } else {
      const stocks = share('us_stocks') + share('intl_stocks');
      const target = Math.min(90, Math.max(30, 110 - data.profile.age));
      if (Math.abs(stocks - target) > 20) {
        const high = stocks > target;
        add({
          id: 'allocation',
          tone: 'watch',
          area: 'Investing',
          title: high ? 'Your portfolio leans heavily on stocks' : 'Your portfolio is light on stocks',
          body: `Stocks are ${stocks.toFixed(0)}% of your investments. A common rule of thumb for age ${data.profile.age} is around ${target}%. ${
            high
              ? 'More stocks means bigger swings, which matters more as retirement gets closer.'
              : 'Holding less in stocks lowers long-run growth, which matters most when retirement is decades away.'
          } It is a guideline, not a rule: what fits depends on how much risk you are comfortable with.`,
          figure: `${stocks.toFixed(0)}% vs ~${target}%`,
          weight: alloc.total * 0.002,
        });
      }
    }
  }

  // ---- Goals ----
  for (const g of data.goals) {
    const s = goalStatus(data, g, today);
    if (s.complete) {
      add({ id: `goal-${g.id}`, tone: 'win', area: 'Goals', title: `${g.name} is done`, body: `You reached ${money(s.total)}. Time to pick the next one.`, weight: 0 });
    } else if (g.targetDate && s.monthsLeft !== null && s.monthsLeft <= 0) {
      add({
        id: `goal-${g.id}`,
        tone: 'action',
        area: 'Goals',
        title: `${g.name} passed its date`,
        body: `${money(s.remaining)} is still to go. Move the date or set a monthly amount you can keep up.`,
        figure: `${money(s.remaining)} to go`,
        weight: s.remaining,
      });
    } else if (s.onTrack === false && s.needed !== null && s.pace !== null) {
      add({
        id: `goal-${g.id}`,
        tone: 'action',
        area: 'Goals',
        title: `${g.name} is falling behind`,
        body: `Hitting ${dayLabel(g.targetDate!, true)} takes ${money(s.needed)} a month. Lately you are ${g.kind === 'payoff' ? 'paying off' : 'adding'} about ${money(Math.max(0, s.pace))} a month.`,
        figure: `+${money(s.needed - Math.max(0, s.pace))} / mo needed`,
        weight: (s.needed - Math.max(0, s.pace)) * 12,
      });
    } else if (s.onTrack) {
      add({
        id: `goal-${g.id}`,
        tone: 'win',
        area: 'Goals',
        title: `${g.name} is on track`,
        body: `${(s.progress * 100).toFixed(0)}% there, moving at about ${money(s.pace ?? 0)} a month against the ${money(s.needed ?? 0)} needed.`,
        weight: 0,
      });
    }
  }
  if (!data.goals.length && data.accounts.length) {
    add({
      id: 'set-goal',
      tone: 'watch',
      area: 'Goals',
      title: 'Name what you are saving for',
      body: 'A goal with an amount and a date turns into a monthly number, and Trove will tell you when you drift off it. Add one in the Plan tab.',
      weight: 100,
    });
  }

  // ---- Net worth trend ----
  const series = netWorthSeries(data, today);
  const then = pointAt(series, addDays(today, -90));
  const now = series[series.length - 1];
  if (then && now && daysBetween(then.date, today) <= 150) {
    const change = now.net - then.net;
    const since = dayLabel(then.date);
    if (change > 0) {
      add({ id: 'net-worth-trend', tone: 'win', area: 'Saving', title: `Net worth is up ${money(change)}`, body: `Since ${since}, from ${money(then.net)} to ${money(now.net)}.`, weight: 0 });
    } else if (change < -Math.max(500, Math.abs(then.net) * 0.03)) {
      add({
        id: 'net-worth-trend',
        tone: 'watch',
        area: 'Saving',
        title: `Net worth is down ${money(-change)}`,
        body: `Since ${since}, from ${money(then.net)} to ${money(now.net)}. Check whether it is markets moving, new debt, or spending from savings: only the last two are in your hands.`,
        weight: -change * 0.1,
      });
    }
  }

  // ---- Upkeep ----
  const stale = data.accounts.filter((a) => daysBetween(a.updatedAt, today) > 35);
  if (stale.length) {
    add({
      id: 'stale-balances',
      tone: 'watch',
      area: 'Upkeep',
      title: `${plural(stale.length, 'balance')} out of date`,
      body: `${stale.slice(0, 3).map((a) => a.name).join(', ')}${stale.length > 3 ? ' and others' : ''} ${stale.length === 1 ? 'has' : 'have'} not been updated in over a month. Your net worth chart is only as current as your balances.`,
      weight: 40,
    });
  }
  const recentSpend = txBetween(data, addDays(today, -60), today).filter((t) => isSpendCat(cats.get(t.categoryId)) && t.amount < 0);
  const loose = recentSpend.filter((t) => t.categoryId === 'other' || !cats.has(t.categoryId));
  if (loose.length >= 5) {
    const share = flow(data, loose).spend / Math.max(1, flow(data, recentSpend).spend);
    if (share > 0.15) {
      add({
        id: 'uncategorized',
        tone: 'watch',
        area: 'Upkeep',
        title: `${loose.length} transactions need a category`,
        body: `${(share * 100).toFixed(0)}% of your recent spending sits in "Everything else". Categorize it once and Trove remembers the merchant from then on.`,
        weight: 30,
      });
    }
  }

  const order: Record<Tone, number> = { action: 0, watch: 1, win: 2 };
  return out
    .filter((i) => data.dismissed[i.id] !== month)
    .sort((a, b) => order[a.tone] - order[b.tone] || b.weight - a.weight);
}
