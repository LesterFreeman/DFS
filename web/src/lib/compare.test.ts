import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { compareOdds, ordinal, verdict } from './compare';

function mk(over: Partial<Player>): Player {
  return {
    id: Math.random().toString(36).slice(2), name: 'X', pos: 'WR', team: 'KC', opp: 'CIN', home: true,
    game: 'CIN@KC', kickoff: null, late: false, salary: 6000, status: 'ACTIVE', status_detail: {},
    status_conflict: false, projections: {}, n_sources: 3, missing_sources: [], proj: 15, proj_sd: 1,
    proj_min: 14, proj_max: 16, td_pts: 4, team_total: 24, opp_total: 21, match: {}, floor: 9, sigma: 8,
    cv: 0.55, hist_games: 10, hist_mean: 15, in_pool: true, ...over,
  };
}

describe('compareOdds', () => {
  it('chances of scoring the most add up to 100%', () => {
    const ps = [mk({ name: 'A', team: 'BUF', game: 'BUF@MIA', opp: 'MIA' }), mk({ name: 'B', team: 'DET', game: 'DET@GB', opp: 'GB' }),
      mk({ name: 'C', team: 'SF', game: 'SF@LA', opp: 'LA', pos: 'RB' })];
    const r = compareOdds(ps, 150);
    expect(r.odds.reduce((s, o) => s + o.pMost, 0)).toBeCloseTo(1, 5);
    expect(r.odds.reduce((s, o) => s + o.pMostPerK, 0)).toBeCloseTo(1, 5);
    expect(r.h2h).toHaveLength(3);
    for (const o of r.odds) expect(o.p10).toBeLessThan(o.p90);
  });

  it('identical players in different games are a coin flip; a much better player wins most', () => {
    const a = mk({ name: 'A', team: 'BUF', game: 'BUF@MIA', opp: 'MIA' });
    const b = mk({ name: 'B', team: 'DET', game: 'DET@GB', opp: 'GB' });
    const even = compareOdds([a, b], 150);
    expect(even.odds[0].pMost).toBeGreaterThan(0.42);
    expect(even.odds[0].pMost).toBeLessThan(0.58);
    const star = mk({ name: 'Star', proj: 24, sigma: 10, team: 'SF', game: 'SF@LA', opp: 'LA' });
    const r = compareOdds([star, b], 150);
    expect(r.odds[0].pMost).toBeGreaterThan(0.7);
    expect(r.h2h[0].pA).toBeCloseTo(r.odds[0].pMost, 5); // two players: head-to-head = most
  });

  it('per-dollar odds favour the cheaper player at equal projections', () => {
    const cheap = mk({ name: 'Cheap', salary: 4000, team: 'BUF', game: 'BUF@MIA', opp: 'MIA' });
    const dear = mk({ name: 'Dear', salary: 8000, team: 'DET', game: 'DET@GB', opp: 'GB' });
    const r = compareOdds([cheap, dear], 150);
    expect(r.odds[0].pMostPerK).toBeGreaterThan(0.7);
    expect(r.odds[0].pPace).toBeGreaterThan(r.odds[1].pPace);
  });
});

describe('verdict', () => {
  it('names a clear winner with supporting reasons', () => {
    const star = mk({ name: 'Star', proj: 24, sigma: 9, salary: 8500, team: 'SF', game: 'SF@LA', opp: 'LA' });
    const cheap = mk({ name: 'Cheap', proj: 14, salary: 4200, team: 'BUF', game: 'BUF@MIA', opp: 'MIA' });
    const v = verdict([star, cheap], compareOdds([star, cheap], 150));
    expect(v.pick).toBe(star.id);
    expect(v.headline).toMatch(/^Pick Star: scores the most in \d+% of 2,000 simulated games/);
    expect(v.reasons.join(' ')).toMatch(/Cheap is the best value.*\$4,300 cheaper/);
  });

  it('calls a coin flip and flags teammates, status, matchups and form', () => {
    const a = mk({ name: 'Wr One', status: 'Q', matchup: { kind: 'defense', allowed: 45, rank: 2, pos_avg: 36, games: 4, teams: 32 },
      log: [1, 2, 3].map((w) => ({ week: 5 - w, opp: 'X', actual: 20, proj: 12, dnp: false, line: {} })) });
    const b = mk({ name: 'Wr Two' });
    const v = verdict([a, b], compareOdds([a, b], 150));
    expect(v.headline).toMatch(/^Coin flip/);
    expect(v.pick).toBeNull();
    const flags = v.flags.join(' ');
    expect(flags).toMatch(/Wr One is Questionable/);
    expect(flags).toMatch(/teammates sharing the ball/);
    expect(flags).toMatch(/softest defenses for WRs \(CIN allows the 2nd-most/);
    expect(flags).toMatch(/beaten our projection in 3 of his last 3/);
  });

  it('flags a defense facing the other player', () => {
    const qb = mk({ name: 'Qb', pos: 'QB', team: 'KC', opp: 'CIN' });
    const dst = mk({ name: 'Bengals DST', pos: 'DST', team: 'CIN', opp: 'KC', proj: 7, sigma: 5 });
    expect(verdict([qb, dst], compareOdds([qb, dst], 150)).flags.join(' ')).toMatch(/Bengals defense faces Qb's offense/);
  });
});

it('ordinal', () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 32].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '32nd']);
});
