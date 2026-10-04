import { describe, expect, it } from 'vitest';
import GLPK from 'glpk.js/node';
import type { BacktestRow, BacktestWeek, Pos } from '../types';
import { spearman, valueQuality, weekLineups } from './backtest';
import { DEFAULT_OPTIONS, type Solver } from './optimizer';
import { DEFAULT_SETTINGS } from './value';

// Teams T0-T1, T2-T3, ... play each other.
const partner = (t: string) => `T${Number(t.slice(1)) ^ 1}`;
const game = (t: string) => [t, partner(t)].sort().join('@');

function row(i: number, pos: Pos, team: string, salary: number, proj: number, actual: number): BacktestRow {
  return {
    id: `${pos}${i}`, name: `${pos} ${i}`, pos, team, opp: partner(team), home: true, game: game(team), kickoff: null, late: false,
    salary, status: 'ACTIVE', projections: { sleeper: proj }, n_sources: 2, proj, proj_sd: 1, proj_min: proj,
    proj_max: proj, team_total: 22, opp_total: 22, floor: proj * 0.6, sigma: proj * 0.5, cv: 0.5, hist_games: 8,
    hist_mean: proj, in_pool: true, actual, played: true,
  };
}

// A slate where actual scores follow projections exactly, except one cheap RB who explodes.
function week(): BacktestWeek {
  const players: BacktestRow[] = [];
  const counts: [Pos, number][] = [['QB', 4], ['RB', 8], ['WR', 10], ['TE', 4], ['DST', 4]];
  for (const [pos, n] of counts) {
    for (let i = 0; i < n; i++) {
      const salary = 3000 + i * 600;
      const proj = salary / 400 + (i % 3);
      players.push(row(i, pos, `T${i}`, salary, proj, proj));
    }
  }
  players.push({ ...row(99, 'RB', 'T99', 3000, 4, 40), in_pool: false });
  return { season: 2026, week: 3, slate_label: null, snapshot_at: null, players, metrics: {} as BacktestWeek['metrics'] };
}

describe('spearman', () => {
  it('handles perfect, reversed and tied rankings', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2, 3], [5, 5, 6, 7])).toBeCloseTo(1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe('valueQuality', () => {
  it('scores the value ranking against what players actually did', () => {
    const q = valueQuality([week()], DEFAULT_SETTINGS);
    expect(q.n).toBe(30);
    expect(q.corrSurplus).not.toBeNull();
    expect(q.corrSurplus!).toBeGreaterThan(0);
    expect(q.topHitRate).toBeGreaterThanOrEqual(0);
    expect(q.topHitRate).toBeLessThanOrEqual(1);
  });
});

describe('weekLineups', () => {
  it('builds lineups from the pool at lock and a hindsight lineup from actual points', async () => {
    const glpk = (await GLPK()) as unknown as Solver;
    const out = await weekLineups(week(), DEFAULT_OPTIONS, glpk);
    expect(out.map((l) => l.label)).toEqual(['Safest (target 125)', 'Highest potential', 'Hindsight best']);
    const up = out[1].players;
    const qb = up.find((p) => p.pos === 'QB')!;
    expect(up.filter((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === qb.team).length).toBeGreaterThanOrEqual(2);
    expect(out[0].ceiling).toBeGreaterThan(out[0].floor);
    for (const l of out) {
      expect(l.players).toHaveLength(9);
      expect(l.salary).toBeLessThanOrEqual(50000);
    }
    expect(out[0].actual).toBeCloseTo(out[0].proj, 1);
    expect(out[0].players.some((p) => p.id === 'RB99')).toBe(false);
    expect(out[2].players.some((p) => p.id === 'RB99')).toBe(true);
    expect(out[2].actual).toBeGreaterThan(out[0].actual);
  });
});
