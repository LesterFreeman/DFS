/**
 * The two lineup modes.
 *
 * Neither goal is linear (a chance of reaching a score; a 90th percentile), so each mode:
 *   1. simulates the slate (sim.ts: correlated, skewed player outcomes),
 *   2. generates candidate lineups with the integer program (optimizer.ts) under several
 *      objectives and structures that suit the goal,
 *   3. scores every candidate on the simulated slates and keeps the best.
 *
 * Safest (cash): maximize P(lineup ≥ target). Candidates trade projection for low variance
 * (proj − λσ for several λ), with and without "spread" (≤2 offensive players per team and no QB
 * with his own pass-catchers), because teammates rise and fall together: a lineup's floor depends
 * on how its players move together, not just on adding up their floors.
 *
 * Highest potential: maximize the lineup's 90th-percentile score. Candidates must stack: a QB,
 * two of his WR/TE and at least one player from the opposing team, from the four games with
 * the highest Vegas totals; the objective adds a bonus for volatility (σ), expected touchdown
 * points and the team's implied total.
 */
import type { Player } from '../types';
import {
  eligible, solveSeries, toLineup, type Lineup, type OptimizerOptions, type Solver, type Spec,
} from './optimizer';
import { lineupStats, simulate, type LineupStats } from './sim';

export interface RankedLineup extends Lineup {
  stats: LineupStats;
  note: string; // how it was built, e.g. "stack KC (game total 51.5)"
}

export interface StrategyResult {
  lineups: RankedLineup[];
  pool: number;
  candidates: number;
  warnings: string[];
}

export const SAFE_LAMBDAS = [0, 0.35, 0.7, 1.0];
export const UPSIDE_KAPPAS = [0.5, 1.0];
const STACK_GAMES = 4;
const TD_BONUS = 0.25; // objective points per expected touchdown point (Highest potential)
const TOTAL_BONUS = 0.15; // objective points per point of implied team total above the slate average

interface Candidate {
  players: Player[];
  note: string;
}

/** Games by Vegas total (team total + opponent total), highest first. */
export function gamesByTotal(pool: Player[]): { teams: [string, string]; total: number | null }[] {
  const seen = new Map<string, { teams: [string, string]; total: number | null }>();
  for (const p of pool) {
    if (!p.game || !p.opp || seen.has(p.game)) continue;
    const total = p.team_total != null && p.opp_total != null ? p.team_total + p.opp_total : null;
    seen.set(p.game, { teams: [p.team, p.opp], total });
  }
  // Without Vegas lines, rank by the projected points of each game's players instead.
  const projected = (teams: string[]) => pool.filter((p) => teams.includes(p.team) && p.pos !== 'DST').reduce((s, p) => s + (p.proj ?? 0), 0);
  return [...seen.values()].sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || projected(b.teams) - projected(a.teams));
}

async function safeCandidates(pool: Player[], opts: OptimizerOptions, glpk: Solver): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const spread of [false, true]) {
    for (const lambda of SAFE_LAMBDAS) {
      const spec: Spec = { spread, scores: pool.map((p) => (p.proj ?? 0) - lambda * (p.sigma ?? (p.proj ?? 0) * 0.6)) };
      const note = `${lambda ? `proj − ${lambda}σ` : 'max projection'}${spread ? ', spread across teams' : ''}`;
      for (const players of await solveSeries(pool, opts, glpk, 3, spec)) out.push({ players, note });
    }
  }
  return out;
}

async function upsideCandidates(pool: Player[], opts: OptimizerOptions, glpk: Solver): Promise<Candidate[]> {
  const offense = pool.filter((p) => p.pos !== 'DST' && p.team_total != null);
  const avgTotal = offense.length ? offense.reduce((s, p) => s + p.team_total!, 0) / offense.length : 0;
  const out: Candidate[] = [];
  const games = gamesByTotal(pool).slice(0, STACK_GAMES);
  // Locks: if a QB is locked, only his team can be the stack.
  const lockedQb = pool.find((p) => p.pos === 'QB' && opts.locks.includes(p.id));
  for (const g of games) {
    for (const team of g.teams) {
      if (lockedQb && lockedQb.team !== team) continue;
      if (!pool.some((p) => p.pos === 'QB' && p.team === team)) continue;
      for (const kappa of UPSIDE_KAPPAS) {
        const scores = pool.map((p) => {
          const proj = p.proj ?? 0;
          const sigma = p.sigma ?? proj * 0.6;
          const env = p.pos !== 'DST' && p.team_total != null ? TOTAL_BONUS * (p.team_total - avgTotal) : 0;
          return proj + kappa * sigma + TD_BONUS * (p.td_pts ?? 0) + env;
        });
        const note = `stack ${team} + bring-back ${g.teams.find((t) => t !== team)}${g.total != null ? ` (game total ${g.total})` : ''}`;
        for (const players of await solveSeries(pool, opts, glpk, 2, { scores, stackTeam: team })) out.push({ players, note });
      }
    }
  }
  return out;
}

/** Build lineups for opts.mode, best first, each differing from the earlier ones by ≥ minDiff players. */
export async function buildLineups(players: Player[], opts: OptimizerOptions, glpk: Solver): Promise<StrategyResult> {
  const { pool, warnings } = eligible(players, opts);
  const cands = opts.mode === 'upside' ? await upsideCandidates(pool, opts, glpk) : await safeCandidates(pool, opts, glpk);
  if (!cands.length) {
    warnings.push(opts.mode === 'upside'
      ? 'No stacked lineup satisfies these locks, excludes and settings.'
      : 'No valid lineup satisfies these locks, excludes and settings.');
    return { lineups: [], pool: pool.length, candidates: 0, warnings };
  }
  const draws = simulate(pool);
  const unique = new Map<string, Candidate>();
  for (const c of cands) {
    const key = c.players.map((p) => p.id).sort().join();
    if (!unique.has(key)) unique.set(key, c); // keep the first (most natural) way it was found
  }
  const ranked = [...unique.values()].map((c) => {
    const stats = lineupStats(c.players.map((p) => p.id), draws, opts.target);
    // Safest: chance of reaching the target, ties broken by the floor. Highest potential: the 90th percentile.
    const key = opts.mode === 'upside' ? stats.p90 : stats.pTarget + stats.p10 / 1e4;
    return { c, stats, key };
  }).sort((a, b) => b.key - a.key);

  const picked: RankedLineup[] = [];
  const minDiff = Math.max(1, opts.minDiff);
  for (const r of ranked) {
    if (picked.length >= Math.max(1, opts.count)) break;
    const ids = new Set(r.c.players.map((p) => p.id));
    const tooClose = picked.some((l) => l.slots.filter((s) => ids.has(s.player.id)).length > 9 - minDiff);
    if (tooClose) continue;
    picked.push({ ...toLineup(r.c.players, opts), stats: r.stats, note: r.c.note });
  }
  return { lineups: picked, pool: pool.length, candidates: unique.size, warnings };
}
