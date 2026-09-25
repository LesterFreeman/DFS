import GLPK from 'glpk.js/node';
import { beforeAll, describe, expect, it } from 'vitest';
import sample from '../../public/data/players.json';
import type { Player, Pos } from '../types';
import { assignSlots, DEFAULT_OPTIONS, eligible, optimize, score, type OptimizerOptions, type Solver } from './optimizer';

const players = sample as unknown as Player[];
let glpk: Solver;
beforeAll(async () => {
  glpk = (await GLPK()) as unknown as Solver;
});

const run = (over: Partial<OptimizerOptions> = {}, pool = players) => optimize(pool, { ...DEFAULT_OPTIONS, ...over }, glpk);

function valid(ids: Player[]): boolean {
  const n = (pos: Pos) => ids.filter((p) => p.pos === pos).length;
  const flex = n('RB') + n('WR') + n('TE');
  return (
    ids.length === 9 && n('QB') === 1 && n('DST') === 1 && n('RB') >= 2 && n('WR') >= 3 && n('TE') >= 1 && flex === 7 &&
    ids.reduce((s, p) => s + p.salary, 0) <= 50000
  );
}

function* combos<T>(xs: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i <= xs.length - (k - acc.length); i++) yield* combos(xs, k, i + 1, [...acc, xs[i]]);
}

describe('optimize', () => {
  it('matches brute force on a small pool', async () => {
    // Best and worst projections at each position, so the salary cap forces real trade-offs.
    const pick = (pos: Pos, k: number) => {
      const ps = players.filter((p) => p.pos === pos && p.in_pool);
      return [...ps.slice(0, Math.ceil(k / 2)), ...ps.slice(-Math.floor(k / 2))];
    };
    const small = [...pick('QB', 2), ...pick('RB', 4), ...pick('WR', 5), ...pick('TE', 3), ...pick('DST', 2)];
    let best = -Infinity;
    let feasible = 0;
    for (const c of combos(small, 9)) {
      if (!valid(c)) continue;
      feasible++;
      best = Math.max(best, c.reduce((s, p) => s + (p.proj ?? 0), 0));
    }
    const priciest = [...small].sort((a, b) => b.salary - a.salary).slice(0, 9).reduce((s, p) => s + p.salary, 0);
    expect(feasible).toBeGreaterThan(0);
    expect(priciest).toBeGreaterThan(50000); // the cap binds
    const res = await run({ noOffenseVsDst: false, count: 1 }, small);
    expect(res.lineups[0].proj).toBeCloseTo(best, 1);
  });

  it('returns valid, distinct, non-improving alternatives', async () => {
    const { lineups } = await run({ count: 5 });
    expect(lineups).toHaveLength(5);
    const keys = new Set<string>();
    lineups.forEach((l, i) => {
      const ps = l.slots.map((s) => s.player);
      expect(valid(ps)).toBe(true);
      keys.add(ps.map((p) => p.id).sort().join());
      if (i) expect(l.score).toBeLessThanOrEqual(lineups[i - 1].score + 1e-6);
    });
    expect(keys.size).toBe(5);
  });

  it('never uses Out/IR players or players without projections', async () => {
    const { lineups } = await run({ count: 3 });
    for (const l of lineups) for (const { player } of l.slots) {
      expect(['O', 'D', 'IR']).not.toContain(player.status);
      expect(player.proj).not.toBeNull();
    }
  });

  it('honors locks and excludes', async () => {
    const base = (await run({ count: 1 })).lineups[0];
    const top = base.slots[0].player; // the QB
    const cheapTe = players.filter((p) => p.pos === 'TE' && p.proj != null).sort((a, b) => a.salary - b.salary)[0];
    const res = await run({ count: 2, locks: [cheapTe.id], excludes: [top.id] });
    for (const l of res.lineups) {
      const ids = l.slots.map((s) => s.player.id);
      expect(ids).toContain(cheapTe.id);
      expect(ids).not.toContain(top.id);
    }
  });

  it('keeps offense away from your own DST and can force a QB stack', async () => {
    const { lineups } = await run({ count: 3, noOffenseVsDst: true, qbStack: true });
    for (const l of lineups) {
      const ps = l.slots.map((s) => s.player);
      const dst = ps.find((p) => p.pos === 'DST')!;
      const qb = ps.find((p) => p.pos === 'QB')!;
      expect(ps.filter((p) => p.pos !== 'DST' && p.opp === dst.team)).toHaveLength(0);
      expect(ps.some((p) => (p.pos === 'WR' || p.pos === 'TE') && p.team === qb.team)).toBe(true);
    }
  });

  it('floor objective trades projection for lower variance', async () => {
    const proj = (await run({ count: 1, objective: 'projection' })).lineups[0];
    const safe = (await run({ count: 1, objective: 'floor', lambda: 1.5 })).lineups[0];
    expect(safe.proj).toBeLessThanOrEqual(proj.proj);
    const sig = (l: typeof proj) => l.slots.reduce((s, x) => s + (x.player.sigma ?? 0), 0);
    expect(sig(safe)).toBeLessThanOrEqual(sig(proj));
  });

  it('reports infeasible settings instead of throwing', async () => {
    const qbs = players.filter((p) => p.pos === 'QB').map((p) => p.id);
    const res = await run({ excludes: qbs });
    expect(res.lineups).toHaveLength(0);
    expect(res.warnings[0]).toMatch(/No valid lineup/);
  });

  it('honors minimum salary', async () => {
    const { lineups } = await run({ count: 2, minSalary: 49800 });
    for (const l of lineups) expect(l.salary).toBeGreaterThanOrEqual(49800);
  });
});

describe('assignSlots', () => {
  it('puts the latest-kickoff flex-eligible player in FLEX', async () => {
    const { lineups } = await run({ count: 3 });
    for (const l of lineups) {
      expect(l.slots.map((s) => s.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DST']);
      const flex = l.slots.find((s) => s.slot === 'FLEX')!.player;
      const kick = (p: Player) => Date.parse(p.kickoff ?? '');
      const others = l.slots.filter((s) => ['RB', 'WR', 'TE'].includes(s.slot) && s.player.pos === flex.pos);
      for (const o of others) expect(kick(flex)).toBeGreaterThanOrEqual(kick(o.player));
    }
  });

  it('handles an extra TE', () => {
    const mk = (pos: Pos, i: number): Player => ({ ...players[0], id: `${pos}${i}`, pos, kickoff: null });
    const slots = assignSlots([mk('QB', 1), mk('RB', 1), mk('RB', 2), mk('WR', 1), mk('WR', 2), mk('WR', 3), mk('TE', 1), mk('TE', 2), mk('DST', 1)]);
    expect(slots.find((s) => s.slot === 'FLEX')!.player.pos).toBe('TE');
  });
});

describe('eligible', () => {
  it('drops questionable players only when asked', () => {
    const q = players.filter((p) => p.status === 'Q' && p.proj != null);
    expect(q.length).toBeGreaterThan(0);
    expect(eligible(players, { ...DEFAULT_OPTIONS, allowQuestionable: false }).pool).not.toContain(q[0]);
    expect(score(q[0], { ...DEFAULT_OPTIONS, objective: 'floor', lambda: 0 })).toBe(q[0].proj);
  });
});
