import { describe, expect, it } from 'vitest';
import sample from '../../public/data/players.json';
import type { Player } from '../types';
import { computeValues, DEFAULT_SETTINGS, fitSalaryCurve, PRESETS, type ValueSettings } from './value';

const players = sample as unknown as Player[];

function mk(over: Partial<Player>): Player {
  return {
    id: Math.random().toString(36).slice(2), name: 'X', pos: 'WR', team: 'KC', opp: 'CIN', home: true,
    game: 'CIN@KC', kickoff: null, late: false, salary: 5000, status: 'ACTIVE', status_detail: {},
    status_conflict: false, projections: {}, n_sources: 3, missing_sources: [], proj: 12, proj_sd: 1,
    proj_min: 11, proj_max: 13, team_total: 24, opp_total: 21, match: {}, floor: 7, sigma: 6, cv: 0.5,
    hist_games: 10, hist_mean: 12, in_pool: true, ...over,
  };
}

describe('fitSalaryCurve', () => {
  it('recovers a linear relationship', () => {
    const fit = fitSalaryCurve([3000, 5000, 7000, 9000].map((s) => ({ salary: s, proj: 2 + s / 500 })));
    expect(fit.b).toBeCloseTo(1 / 500);
    expect(fit.a).toBeCloseTo(2);
  });
});

describe('computeValues', () => {
  const valued = computeValues(players);
  const byName = Object.fromEntries(valued.map((p) => [p.name, p]));

  it('keeps every player and ranks the pool within each position', () => {
    expect(valued).toHaveLength(players.length);
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST']) {
      const ranks = valued.filter((p) => p.pos === pos && p.inValuePool).map((p) => p.posRank).sort((a, b) => a! - b!);
      expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    }
  });

  it('explains why players are outside the pool', () => {
    expect(byName['Noah Gray'].poolReason).toBe('no projection');
    expect(byName['Noah Gray'].value).toBeNull();
    expect(byName['Christian Watson'].poolReason).toBe('status O');
    expect(byName['Tee Higgins'].inValuePool).toBe(true);
  });

  it('z-scores are centered within position', () => {
    const wr = valued.filter((p) => p.pos === 'WR' && p.inValuePool);
    const meanZ = wr.reduce((s, p) => s + p.components!.z.efficiency, 0) / wr.length;
    expect(Math.abs(meanZ)).toBeLessThan(0.15); // clipping can shift it slightly
  });

  it('pure-efficiency preset ranks exactly by points per $1K', () => {
    const s: ValueSettings = { ...DEFAULT_SETTINGS, weights: PRESETS['Pure efficiency'] };
    const rb = computeValues(players, s).filter((p) => p.pos === 'RB' && p.inValuePool);
    const byValue = [...rb].sort((a, b) => b.value! - a.value!).map((p) => p.name);
    const byEff = [...rb].sort((a, b) => b.proj! / b.salary - a.proj! / a.salary).map((p) => p.name);
    expect(byValue).toEqual(byEff);
  });

  it('budget surplus rewards chunky points that pure efficiency ignores', () => {
    // Same points per $1K; the expensive player adds more points above the required pace.
    const pair = [mk({ name: 'Stud', salary: 9000, proj: 27 }), mk({ name: 'Punt', salary: 3000, proj: 9 }),
      mk({ name: 'Mid', salary: 6000, proj: 15 })];
    const v = computeValues(pair, { ...DEFAULT_SETTINGS, targetTotal: 135 });
    const get = (n: string) => v.find((p) => p.name === n)!.components!;
    expect(get('Stud').efficiency).toBeCloseTo(get('Punt').efficiency);
    expect(get('Stud').budget).toBeGreaterThan(get('Punt').budget);
  });

  it('source disagreement and questionable status lower reliability', () => {
    const base = [mk({ name: 'Agree', proj_sd: 0.2 }), mk({ name: 'Disagree', proj_sd: 3 }), mk({ name: 'Other', proj_sd: 1 })];
    const v = computeValues(base);
    const rel = (n: string) => v.find((p) => p.name === n)!.components!.reliability;
    expect(rel('Agree')).toBeGreaterThan(rel('Disagree'));
    const q = computeValues(base.map((p) => (p.name === 'Agree' ? { ...p, status: 'Q' as const } : p)));
    expect(q.find((p) => p.name === 'Agree')!.components!.reliability).toBeCloseTo(rel('Agree') - 0.5);
  });

  it('can exclude questionable players from the pool', () => {
    const v = computeValues(players, { ...DEFAULT_SETTINGS, excludeQuestionable: true });
    expect(v.find((p) => p.name === 'Tee Higgins')!.inValuePool).toBe(false);
  });
});
