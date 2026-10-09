import GLPK from 'glpk.js/node';
import { beforeAll, describe, expect, it } from 'vitest';
import sample from '../../public/data/players.json';
import type { Player } from '../types';
import { DEFAULT_OPTIONS, type OptimizerOptions, type Solver } from './optimizer';
import { correlation, lineupStats, simulate } from './sim';
import { buildLineups, gamesByTotal } from './strategies';

const players = sample as unknown as Player[];
let glpk: Solver;
beforeAll(async () => {
  glpk = (await GLPK()) as unknown as Solver;
});
const pool = players.filter((p) => p.in_pool);
const draws = simulate(pool);
const find = (pos: string, team: string) => pool.find((p) => p.pos === pos && p.team === team)!;

describe('simulate', () => {
  it('keeps each player near his projection, never below zero, skewed upward', () => {
    for (const p of pool.slice(0, 20)) {
      const d = draws.get(p.id)!;
      const mean = d.reduce((s, x) => s + x, 0) / d.length;
      expect(mean).toBeGreaterThan(p.proj! * 0.93);
      expect(mean).toBeLessThan(p.proj! * 1.07);
      if (p.pos !== 'DST') expect(Math.min(...d)).toBeGreaterThanOrEqual(0);
      const sorted = [...d].sort((a, b) => a - b);
      expect(sorted[Math.floor(d.length / 2)]).toBeLessThan(mean); // median below mean: right skew
    }
  });

  it('links teammates and opponents the way real scores move (as measured in the backtest)', () => {
    const qb = find('QB', 'KC');
    const wrs = pool.filter((p) => p.pos === 'WR' && p.team === 'KC');
    const oppWr = pool.find((p) => p.pos === 'WR' && p.team === qb.opp)!;
    const oppDst = find('DST', qb.opp!);
    const far = pool.find((p) => p.pos === 'WR' && p.game !== qb.game)!;
    const c = (a: Player, b: Player) => correlation(draws.get(a.id)!, draws.get(b.id)!);
    expect(c(qb, wrs[0])).toBeGreaterThan(0.1); // QB and his receiver rise together
    expect(c(wrs[0], wrs[1])).toBeLessThan(0.02); // receivers share targets
    expect(Math.abs(c(qb, oppWr))).toBeLessThan(0.08); // shootouts are a weak link
    expect(c(qb, oppDst)).toBeLessThan(-0.15); // a defense suffers when the QB it faces does well
    expect(Math.abs(c(qb, far))).toBeLessThan(0.08);
  });

  it('produces bust games and lets defenses go negative', () => {
    const wr = pool.find((p) => p.pos === 'WR' && (p.proj ?? 0) > 10)!;
    const d = draws.get(wr.id)!;
    const busts = d.filter((x) => x < 0.25 * wr.proj!).length / d.length;
    expect(busts).toBeGreaterThan(0.05);
    expect(busts).toBeLessThan(0.2);
    const dst = pool.find((p) => p.pos === 'DST')!;
    expect(Math.min(...draws.get(dst.id)!)).toBeLessThan(0);
  });

  it('builds a valid correlation factor even from an impossible table', async () => {
    const { cholesky } = await import('./sim');
    const bad = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
    const L = cholesky(bad);
    expect(L.every((row, i) => row[i] > 0)).toBe(true);
  });

  it('is deterministic for a given slate', () => {
    expect(simulate(pool).get(pool[0].id)![17]).toBe(draws.get(pool[0].id)![17]);
  });
});

describe('lineupStats', () => {
  it('orders percentiles and measures the chance of reaching a target', () => {
    const ids = pool.slice(0, 9).map((p) => p.id);
    const s = lineupStats(ids, draws, 0);
    expect(s.pTarget).toBe(1);
    expect(s.p10).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p90);
    expect(lineupStats(ids, draws, 1e6).pTarget).toBe(0);
  });
});

const run = (over: Partial<OptimizerOptions>) => buildLineups(players, { ...DEFAULT_OPTIONS, count: 3, ...over }, glpk);

describe('buildLineups', () => {
  it('Safest: valid lineups ranked by the chance of reaching the target', async () => {
    const res = await run({ mode: 'safe', target: 110 });
    expect(res.lineups.length).toBe(3);
    expect(res.candidates).toBeGreaterThan(5);
    for (const l of res.lineups) {
      expect(l.slots).toHaveLength(9);
      expect(l.salary).toBeLessThanOrEqual(50000);
    }
    const p = res.lineups.map((l) => l.stats.pTarget);
    expect(p[0]).toBeGreaterThanOrEqual(p[1]);
    expect(p[1]).toBeGreaterThanOrEqual(p[2]);
  });

  it('Highest potential: QB + 2 pass-catchers + bring-back from a high-total game, ranked by ceiling', async () => {
    const res = await run({ mode: 'upside' });
    const top = gamesByTotal(players.filter((p) => p.in_pool)).slice(0, 4).flatMap((g) => g.teams);
    expect(res.lineups.length).toBe(3);
    for (const l of res.lineups) {
      const ps = l.slots.map((s) => s.player);
      const qb = ps.find((p) => p.pos === 'QB')!;
      expect(top).toContain(qb.team);
      expect(ps.filter((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === qb.team).length).toBeGreaterThanOrEqual(2);
      expect(ps.some((p) => p.pos !== 'DST' && p.pos !== 'QB' && p.team === qb.opp)).toBe(true);
      expect(l.note).toMatch(/^stack /);
    }
    const p90 = res.lineups.map((l) => l.stats.p90);
    expect(p90[0]).toBeGreaterThanOrEqual(p90[1]);
  });

  it('the modes trade off as intended', async () => {
    const safe = (await run({ mode: 'safe', count: 1 })).lineups[0];
    const up = (await run({ mode: 'upside', count: 1 })).lineups[0];
    expect(up.stats.p90).toBeGreaterThan(safe.stats.p90);
    expect(safe.stats.p10).toBeGreaterThan(up.stats.p10);
  });

  it('honors locks and excludes', async () => {
    const base = (await run({ mode: 'safe', count: 1 })).lineups[0];
    const qb = base.slots[0].player;
    const te = pool.filter((p) => p.pos === 'TE').sort((a, b) => a.salary - b.salary)[0];
    for (const mode of ['safe', 'upside'] as const) {
      const res = await run({ mode, locks: [te.id], excludes: [qb.id] });
      for (const l of res.lineups) {
        const ids = l.slots.map((s) => s.player.id);
        expect(ids).toContain(te.id);
        expect(ids).not.toContain(qb.id);
      }
    }
  });
});
