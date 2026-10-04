/**
 * Lineup optimizer: integer program solved with GLPK (glpk.js, WebAssembly).
 *
 *   maximize   Σ scoreᵢ·xᵢ          scoreᵢ = proj  or  proj − λ·σ  (floor-weighted, for cash)
 *   subject to Σ salaryᵢ·xᵢ ≤ 50,000  (and ≥ min salary if set)
 *              Σ xᵢ = 9;  QB = 1;  DST = 1;  2 ≤ RB ≤ 3;  3 ≤ WR ≤ 4;  1 ≤ TE ≤ 2
 *              xᵢ = 1 for locked players; excluded players are not variables
 *              optional: no offensive player facing your DST; QB paired with ≥1 own WR/TE
 *              for each earlier lineup L: Σ_{i∈L} xᵢ ≤ 9 − minDiff   (next-best alternatives)
 *
 * This is the engine. The two lineup modes (Safest, Highest potential) in strategies.ts call it
 * many times with different scores and structural constraints (Spec) to generate candidates,
 * then judge the candidates by simulation.
 */
import type { LP, Result } from 'glpk.js';
import type { Player, Pos } from '../types';
import { SALARY_CAP } from './value';

export interface Solver {
  GLP_MAX: number;
  GLP_UP: number;
  GLP_LO: number;
  GLP_FX: number;
  GLP_DB: number;
  GLP_OPT: number;
  GLP_FEAS: number;
  solve(lp: LP, options?: object): Result | Promise<Result>;
}

export interface OptimizerOptions {
  mode: 'safe' | 'upside'; // Safest (cash) or Highest potential, see strategies.ts
  target: number; // Safest: the score a lineup should reach (e.g. a double-up cash line)
  objective: 'projection' | 'floor';
  lambda: number; // σ penalty for the floor objective
  locks: string[];
  excludes: string[];
  count: number; // lineups to return (best + alternatives)
  minDiff: number; // each alternative differs from every earlier lineup by ≥ this many players
  minSalary: number; // 0 = off
  noOffenseVsDst: boolean;
  qbStack: boolean;
  allowQuestionable: boolean;
}

export const DEFAULT_OPTIONS: OptimizerOptions = {
  mode: 'safe',
  target: 125,
  objective: 'projection',
  lambda: 0.5,
  locks: [],
  excludes: [],
  count: 5,
  minDiff: 1,
  minSalary: 0,
  noOffenseVsDst: true,
  qbStack: false,
  allowQuestionable: true,
};

export type Slot = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'DST';

export interface Lineup {
  slots: { slot: Slot; player: Player }[];
  salary: number;
  proj: number;
  floor: number;
  score: number;
}

export interface OptimizeResult {
  lineups: Lineup[];
  pool: number;
  warnings: string[];
}

const LIMITS: Record<Pos, [number, number]> = { QB: [1, 1], RB: [2, 3], WR: [3, 4], TE: [1, 2], DST: [1, 1] };

export function score(p: Player, opts: OptimizerOptions): number {
  const proj = p.proj ?? 0;
  if (opts.objective === 'projection') return proj;
  const sigma = p.sigma ?? proj * 0.6;
  return proj - opts.lambda * sigma;
}

export function eligible(players: Player[], opts: OptimizerOptions): { pool: Player[]; warnings: string[] } {
  const locks = new Set(opts.locks);
  const excludes = new Set(opts.excludes);
  const warnings: string[] = [];
  const pool = players.filter((p) => {
    if (locks.has(p.id)) {
      if (p.proj == null) warnings.push(`${p.name} is locked but has no projection`);
      if (['D', 'O', 'IR'].includes(p.status)) warnings.push(`${p.name} is locked but listed ${p.status}`);
      return true;
    }
    if (excludes.has(p.id) || p.proj == null || p.proj <= 0) return false;
    if (['D', 'O', 'IR'].includes(p.status)) return false;
    if (p.status === 'Q' && !opts.allowQuestionable) return false;
    return true;
  });
  return { pool, warnings };
}

/** Extra structure for one candidate search. */
export interface Spec {
  scores?: number[]; // per-pool-player objective, replacing score(p, opts)
  stackTeam?: string; // QB from this team + ≥2 of its WR/TE + ≥1 RB/WR/TE from its opponent
  spread?: boolean; // ≤2 offensive players per team and no QB with his own WR/TE (less correlated)
}

export function buildLP(pool: Player[], opts: OptimizerOptions, previous: string[][], glpk: Solver, spec: Spec = {}): LP {
  const v = (i: number) => `x${i}`;
  const all = pool.map((_, i) => ({ name: v(i), coef: 1 }));
  const where = (f: (p: Player) => boolean) => pool.flatMap((p, i) => (f(p) ? [{ name: v(i), coef: 1 }] : []));
  const subjectTo: LP['subjectTo'] = [
    {
      name: 'salary',
      vars: pool.map((p, i) => ({ name: v(i), coef: p.salary })),
      bnds: opts.minSalary > 0
        ? { type: glpk.GLP_DB, lb: opts.minSalary, ub: SALARY_CAP }
        : { type: glpk.GLP_UP, lb: 0, ub: SALARY_CAP },
    },
    { name: 'roster', vars: all, bnds: { type: glpk.GLP_FX, lb: 9, ub: 9 } },
  ];
  for (const [pos, [lb, ub]] of Object.entries(LIMITS) as [Pos, [number, number]][]) {
    subjectTo.push({
      name: `pos_${pos}`,
      vars: where((p) => p.pos === pos),
      bnds: lb === ub ? { type: glpk.GLP_FX, lb, ub } : { type: glpk.GLP_DB, lb, ub },
    });
  }
  const locks = new Set(opts.locks);
  pool.forEach((p, i) => {
    if (locks.has(p.id)) subjectTo.push({ name: `lock_${i}`, vars: [{ name: v(i), coef: 1 }], bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 } });
  });
  if (opts.noOffenseVsDst) {
    // Σ(offense facing this DST) + 9·x_dst ≤ 9
    pool.forEach((d, j) => {
      if (d.pos !== 'DST') return;
      const facing = where((p) => p.pos !== 'DST' && p.opp === d.team);
      if (facing.length) {
        subjectTo.push({ name: `vsdst_${j}`, vars: [...facing, { name: v(j), coef: 9 }], bnds: { type: glpk.GLP_UP, lb: 0, ub: 9 } });
      }
    });
  }
  if (opts.qbStack) {
    // Σ(own WR/TE) − x_qb ≥ 0
    pool.forEach((q, j) => {
      if (q.pos !== 'QB') return;
      const mates = where((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === q.team);
      subjectTo.push({ name: `stack_${j}`, vars: [...mates, { name: v(j), coef: -1 }], bnds: { type: glpk.GLP_LO, lb: 0, ub: 0 } });
    });
  }
  if (spec.stackTeam) {
    const t = spec.stackTeam;
    const opp = pool.find((p) => p.pos === 'QB' && p.team === t)?.opp;
    subjectTo.push({ name: 'stack_qb', vars: where((p) => p.pos === 'QB' && p.team === t), bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 } });
    subjectTo.push({ name: 'stack_mates', vars: where((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === t), bnds: { type: glpk.GLP_LO, lb: 2, ub: 0 } });
    if (opp) {
      subjectTo.push({ name: 'stack_bringback', vars: where((p) => ['RB', 'WR', 'TE'].includes(p.pos) && p.team === opp), bnds: { type: glpk.GLP_LO, lb: 1, ub: 0 } });
    }
  }
  if (spec.spread) {
    for (const t of new Set(pool.map((p) => p.team))) {
      const vars = where((p) => p.pos !== 'DST' && p.team === t);
      if (vars.length > 2) subjectTo.push({ name: `spread_${t}`, vars, bnds: { type: glpk.GLP_UP, lb: 0, ub: 2 } });
    }
    pool.forEach((q, j) => {
      if (q.pos !== 'QB') return;
      const mates = where((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === q.team);
      if (mates.length) subjectTo.push({ name: `nostack_${j}`, vars: [...mates, { name: v(j), coef: 9 }], bnds: { type: glpk.GLP_UP, lb: 0, ub: 9 } });
    });
  }
  previous.forEach((ids, k) => {
    const set = new Set(ids);
    subjectTo.push({
      name: `alt_${k}`,
      vars: where((p) => set.has(p.id)),
      bnds: { type: glpk.GLP_UP, lb: 0, ub: 9 - Math.max(1, opts.minDiff) },
    });
  });
  return {
    name: 'dk_classic',
    objective: { direction: glpk.GLP_MAX, name: 'score', vars: pool.map((p, i) => ({ name: v(i), coef: round(spec.scores?.[i] ?? score(p, opts)) })) },
    subjectTo,
    binaries: pool.map((_, i) => v(i)),
  };
}

/** Order as DK does (QB, RB, RB, WR, WR, WR, TE, FLEX, DST). FLEX gets the latest-kickoff
 *  eligible player, which keeps late-swap options open. */
export function assignSlots(players: Player[]): Lineup['slots'] {
  const byPos = (pos: Pos) => players.filter((p) => p.pos === pos);
  const kick = (p: Player) => (p.kickoff ? Date.parse(p.kickoff) : 0);
  const counts = { RB: byPos('RB').length, WR: byPos('WR').length, TE: byPos('TE').length };
  const flexCandidates = players.filter(
    (p) => (p.pos === 'RB' && counts.RB > 2) || (p.pos === 'WR' && counts.WR > 3) || (p.pos === 'TE' && counts.TE > 1),
  );
  const flex = [...flexCandidates].sort((a, b) => kick(b) - kick(a) || (a.proj ?? 0) - (b.proj ?? 0))[0];
  const rest = (pos: Pos) => byPos(pos).filter((p) => p !== flex).sort((a, b) => kick(a) - kick(b));
  return [
    ...rest('QB').map((player) => ({ slot: 'QB' as Slot, player })),
    ...rest('RB').map((player) => ({ slot: 'RB' as Slot, player })),
    ...rest('WR').map((player) => ({ slot: 'WR' as Slot, player })),
    ...rest('TE').map((player) => ({ slot: 'TE' as Slot, player })),
    ...(flex ? [{ slot: 'FLEX' as Slot, player: flex }] : []),
    ...rest('DST').map((player) => ({ slot: 'DST' as Slot, player })),
  ];
}

/** The best `count` lineups for one objective/structure, each differing from the earlier ones. */
export async function solveSeries(pool: Player[], opts: OptimizerOptions, glpk: Solver, count: number,
  spec: Spec = {}, previous: string[][] = []): Promise<Player[][]> {
  const out: Player[][] = [];
  const prev = [...previous];
  for (let n = 0; n < Math.max(1, count); n++) {
    const res = await glpk.solve(buildLP(pool, opts, prev, glpk, spec), { msglev: 0, presol: true, tmlim: 10 });
    const { status, vars } = res.result;
    if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) break;
    const chosen = pool.filter((_, i) => vars[`x${i}`] > 0.5);
    if (chosen.length !== 9) break;
    prev.push(chosen.map((p) => p.id));
    out.push(chosen);
  }
  return out;
}

export function toLineup(chosen: Player[], opts: OptimizerOptions): Lineup {
  return {
    slots: assignSlots(chosen),
    salary: sum(chosen.map((p) => p.salary)),
    proj: round(sum(chosen.map((p) => p.proj ?? 0))),
    floor: round(sum(chosen.map((p) => p.floor ?? 0))),
    score: round(sum(chosen.map((p) => score(p, opts)))),
  };
}

/** Plain optimizer: maximize projection (or proj − λσ). Used by the hindsight lineup and tests. */
export async function optimize(players: Player[], opts: OptimizerOptions, glpk: Solver): Promise<OptimizeResult> {
  const { pool, warnings } = eligible(players, opts);
  const lineups: Lineup[] = [];
  const previous: string[][] = [];
  for (let n = 0; n < Math.max(1, opts.count); n++) {
    const lp = buildLP(pool, opts, previous, glpk);
    const res = await glpk.solve(lp, { msglev: 0, presol: true, tmlim: 10 });
    const { status, vars } = res.result;
    if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) {
      if (n === 0) warnings.push('No valid lineup satisfies these locks, excludes and settings.');
      break;
    }
    const chosen = pool.filter((_, i) => vars[`x${i}`] > 0.5);
    if (chosen.length !== 9) break;
    previous.push(chosen.map((p) => p.id));
    lineups.push({
      slots: assignSlots(chosen),
      salary: sum(chosen.map((p) => p.salary)),
      proj: round(sum(chosen.map((p) => p.proj ?? 0))),
      floor: round(sum(chosen.map((p) => p.floor ?? 0))),
      score: round(sum(chosen.map((p) => score(p, opts)))),
    });
  }
  return { lineups, pool: pool.length, warnings };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round = (x: number) => Math.round(x * 100) / 100;
