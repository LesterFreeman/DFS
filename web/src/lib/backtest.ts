/**
 * Backtest helpers: rerun the value model and optimizer on past weeks and compare with what
 * players actually scored. Projection and floor accuracy are computed by the pipeline
 * (pipeline/dfs/backtest.py); value-ranking and lineup results are computed here so they follow
 * the current value weights and optimizer settings.
 */
import type { Backtest, BacktestRow, BacktestWeek, Player, Pos } from '../types';
import { optimize, type OptimizerOptions, type Solver } from './optimizer';
import { buildLineups } from './strategies';
import { computeValues, SALARY_CAP, type ValueSettings } from './value';

export const POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE', 'DST'];

export async function loadBacktest(): Promise<Backtest | null> {
  const res = await fetch(`./data/backtest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`backtest.json: HTTP ${res.status}`);
  return (await res.json()) as Backtest;
}

/** A backtest row as a full Player (the fields the bundle leaves out are display-only). */
export function asPlayer(r: BacktestRow): Player & { actual: number; played: boolean } {
  return { ...r, status_detail: {}, status_conflict: false, missing_sources: [], match: {} };
}

/** Average ranks (ties share the mean rank). */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; null with fewer than 3 points or no variation. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const m = (rx.length + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - m) * (ry[i] - m);
    sxx += (rx[i] - m) ** 2;
    syy += (ry[i] - m) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export interface ValueQuality {
  n: number;
  /** rank correlation of value with actual points above salary pace (actual − salary·T/50,000),
   *  averaged over positions weighted by players */
  corrSurplus: number | null;
  /** same, with actual points per $1K */
  corrPerK: number | null;
  /** share of each position's top-3 by value that reached salary pace */
  topHitRate: number | null;
  topN: number;
}

/** How well the value ranking ordered players who played, under the given settings. */
export function valueQuality(weeks: BacktestWeek[], settings: ValueSettings, top = 3): ValueQuality {
  const pace = settings.targetTotal / SALARY_CAP;
  let n = 0;
  let wSurplus = 0;
  let sumSurplus = 0;
  let wPerK = 0;
  let sumPerK = 0;
  let hits = 0;
  let tops = 0;
  for (const wk of weeks) {
    const actual = new Map(wk.players.map((r) => [r.id, r]));
    const valued = computeValues(wk.players.map(asPlayer), settings);
    for (const pos of POSITIONS) {
      const pool = valued.filter((p) => p.pos === pos && p.inValuePool && p.value != null && actual.get(p.id)?.played);
      if (!pool.length) continue;
      const a = pool.map((p) => actual.get(p.id)!.actual);
      const v = pool.map((p) => p.value!);
      const cs = spearman(v, a.map((x, i) => x - pool[i].salary * pace));
      const ck = spearman(v, a.map((x, i) => x / (pool[i].salary / 1000)));
      if (cs != null) {
        sumSurplus += cs * pool.length;
        wSurplus += pool.length;
      }
      if (ck != null) {
        sumPerK += ck * pool.length;
        wPerK += pool.length;
      }
      n += pool.length;
      const best = [...pool].sort((x, y) => y.value! - x.value!).slice(0, top);
      tops += best.length;
      hits += best.filter((p) => actual.get(p.id)!.actual >= p.salary * pace).length;
    }
  }
  return {
    n,
    corrSurplus: wSurplus ? sumSurplus / wSurplus : null,
    corrPerK: wPerK ? sumPerK / wPerK : null,
    topHitRate: tops ? hits / tops : null,
    topN: top,
  };
}

export interface LineupOutcome {
  label: string;
  players: (Player & { actual: number; played: boolean })[];
  salary: number;
  proj: number;
  floor: number; // simulated 10th percentile (lineup modes) or sum of floors (hindsight)
  ceiling?: number; // simulated 90th percentile
  actual: number;
}

/** Best lineup for a past week under each optimizer setting, plus the hindsight-perfect lineup. */
export async function weekLineups(wk: BacktestWeek, options: OptimizerOptions, glpk: Solver): Promise<LineupOutcome[]> {
  const players = wk.players.map(asPlayer);
  const byId = new Map(players.map((p) => [p.id, p]));
  const base: OptimizerOptions = { ...options, locks: [], excludes: [], count: 1, minSalary: 0, objective: 'projection' };
  const runs: [string, OptimizerOptions][] = [
    [`Safest (target ${options.target})`, { ...base, mode: 'safe' }],
    ['Highest potential', { ...base, mode: 'upside' }],
  ];
  const out: LineupOutcome[] = [];
  for (const [label, opts] of runs) {
    // Lineups are built only from players who were in the pool at lock.
    const res = await buildLineups(players.filter((p) => p.in_pool), opts, glpk);
    const l = res.lineups[0];
    if (!l) continue;
    const ps = l.slots.map((s) => byId.get(s.player.id)!);
    out.push({
      label, players: ps, salary: l.salary, proj: l.proj, floor: Math.round(l.stats.p10 * 10) / 10,
      ceiling: Math.round(l.stats.p90 * 10) / 10, actual: total(ps.map((p) => p.actual)),
    });
  }
  // Hindsight: the best lineup anyone could have built, scoring players by what they actually did.
  const hindsight = players.filter((p) => p.played).map((p) => ({ ...p, proj: p.actual, status: 'ACTIVE' as const }));
  const res = await optimize(hindsight, { ...base, objective: 'projection', noOffenseVsDst: false, qbStack: false, allowQuestionable: true }, glpk);
  const l = res.lineups[0];
  if (l) {
    const ps = l.slots.map((s) => byId.get(s.player.id)!);
    out.push({
      label: 'Hindsight best',
      players: ps,
      salary: l.salary,
      proj: total(ps.map((p) => p.proj ?? 0)),
      floor: total(ps.map((p) => p.floor ?? 0)),
      actual: total(ps.map((p) => p.actual)),
    });
  }
  return out;
}

const total = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
