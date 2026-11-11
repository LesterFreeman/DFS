import type { Plan } from './types';

// A Monte Carlo projection in today's money. Each simulated path draws a random real (after
// inflation) return every year; the chart shows the middle path and the range most paths fall in.

export interface ProjectionInput {
  age: number;
  /** Cash, investments and retirement accounts, minus non-mortgage debt. */
  investable: number;
  /** Property minus mortgage. Held flat in today's money and never spent. 0 to leave it out. */
  homeEquity: number;
  plan: Plan;
  endAge?: number;
  paths?: number;
  seed?: number;
}

export interface ProjectionYear {
  age: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface ProjectionResult {
  years: ProjectionYear[];
  atRetire: ProjectionYear;
  /** Share of simulated paths that still have money at the end age (0 to 1). */
  success: number;
  /** 25 times yearly retirement spending not covered by other income (the 4% guideline). */
  fiNumber: number;
  /** Age at which the middle path first reaches the FI number, or null if it never does. */
  fiAge: number | null;
  /** Age at which the middle path runs out, or null. */
  runsOutAge: number | null;
}

export const END_AGE = 95;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const quantile = (sorted: Float64Array, q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export const realReturn = (plan: Plan) => (1 + plan.returnPct / 100) / (1 + plan.inflationPct / 100) - 1;

export function project(input: ProjectionInput): ProjectionResult {
  const { plan } = input;
  const endAge = Math.max(input.endAge ?? END_AGE, input.age + 1);
  const paths = input.paths ?? 1000;
  const n = endAge - input.age;
  const rand = mulberry32(input.seed ?? 20260101);

  // Lognormal yearly growth with the requested mean and spread, so a year can never lose more than everything.
  const mu = realReturn(plan);
  const sigma = Math.max(0, plan.volatilityPct / 100);
  const s2 = Math.log(1 + (sigma * sigma) / ((1 + mu) * (1 + mu)));
  const m = Math.log(1 + mu) - s2 / 2;
  const s = Math.sqrt(s2);

  const withdraw = Math.max(0, plan.retireSpend - plan.retireIncome) * 12;
  const columns = Array.from({ length: n + 1 }, () => new Float64Array(paths));
  let survived = 0;

  for (let p = 0; p < paths; p++) {
    let v = input.investable;
    let failed = false;
    columns[0][p] = v;
    for (let t = 0; t < n; t++) {
      const growth = Math.exp(m + s * normal(rand));
      if (input.age + t < plan.retireAge) {
        const contribution = plan.monthlyInvest * 12 * Math.pow(1 + plan.raisePct / 100, t);
        // Debt (a negative start) is carried at the same rate rather than compounding randomly.
        v = (v > 0 ? v * growth : v) + contribution * Math.sqrt(growth);
      } else {
        if (v < withdraw && withdraw > 0) failed = true;
        v = Math.max(0, v - withdraw) * growth;
      }
      columns[t + 1][p] = v;
    }
    if (!failed) survived++;
  }

  const home = Math.max(0, input.homeEquity);
  const core = columns.map((col, t) => {
    const sorted = col.slice().sort();
    return { age: input.age + t, p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
  });

  const fiNumber = withdraw * 25;
  let fiAge: number | null = null;
  let runsOutAge: number | null = null;
  for (const y of core) {
    if (fiAge === null && fiNumber > 0 && y.p50 >= fiNumber && y.age <= plan.retireAge) fiAge = y.age;
    if (runsOutAge === null && y.age > plan.retireAge && y.p50 <= 0 && withdraw > 0) runsOutAge = y.age;
  }

  const years = core.map((y) => ({ age: y.age, p10: y.p10 + home, p50: y.p50 + home, p90: y.p90 + home }));
  const retireIdx = Math.min(Math.max(plan.retireAge - input.age, 0), n);
  return { years, atRetire: years[retireIdx], success: survived / paths, fiNumber, fiAge, runsOutAge };
}

/** What an amount in today's money will be called in `years` years. */
export const toFutureMoney = (value: number, years: number, inflationPct: number) =>
  value * Math.pow(1 + inflationPct / 100, years);

/**
 * The smallest monthly amount (rounded up to $25) that reaches the target chance of the money lasting.
 * Null when the current amount already gets there, or when no reasonable amount does.
 */
export function requiredMonthly(input: ProjectionInput, target = 0.85): number | null {
  const run = (monthlyInvest: number) =>
    project({ ...input, paths: 250, plan: { ...input.plan, monthlyInvest } }).success;
  if (input.age >= input.plan.retireAge) return null;
  if (run(input.plan.monthlyInvest) >= target) return null;
  let lo = input.plan.monthlyInvest;
  let hi = Math.max(500, lo * 2);
  while (run(hi) < target) {
    lo = hi;
    hi *= 2;
    if (hi > 50000) return null;
  }
  for (let i = 0; i < 12 && hi - lo > 25; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 25) * 25;
}
