import { describe, expect, it } from 'vitest';
import sample from '../../public/data/players.json';
import slateJson from '../../public/data/slate.json';
import type { Player, Slate } from '../types';
import { blurb, MAX_WORDS, playerFacts, shortName, wordCount } from './blurb';
import { slateRanks } from './slateRanks';
import { computeValues } from './value';

const players = computeValues(sample as unknown as Player[]);
const ranks = slateRanks(slateJson as unknown as Slate);

function mk(over: Partial<Player> & { value?: number | null }): Player & { value: number | null } {
  return {
    id: 'x1', name: 'Joe Test', pos: 'WR', team: 'KC', opp: 'CIN', home: true, game: 'CIN@KC', kickoff: null,
    late: false, salary: 6000, status: 'ACTIVE', status_detail: {}, status_conflict: false, projections: {},
    n_sources: 3, missing_sources: [], proj: 15, proj_sd: 1, proj_min: 14, proj_max: 16, td_pts: 4,
    team_total: 24, opp_total: 21, match: {}, floor: 9, sigma: 8, cv: 0.5, hist_games: 10, hist_mean: 15,
    in_pool: true, value: 0, ...over,
  };
}

describe('blurb', () => {
  it('stays within 50 words, without placeholders, for every sample player', () => {
    for (const p of players) {
      const text = blurb(playerFacts(p, ranks, { p10: (p.proj ?? 0) * 0.5, p90: (p.proj ?? 0) * 1.6 }), `${p.id}-4`);
      expect(wordCount(text), text).toBeLessThanOrEqual(MAX_WORDS);
      expect(text).not.toMatch(/undefined|NaN|null|Infinity/);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it('is deterministic for a player and week, and varies across players', () => {
    const f = playerFacts(mk({ value: 1.5 }), ranks, null);
    expect(blurb(f, 'a-5')).toBe(blurb(f, 'a-5'));
    const texts = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => blurb(f, `${k}-5`)));
    expect(texts.size).toBeGreaterThan(1);
  });

  it('leads with the main story and uses the real numbers', () => {
    const elite = blurb(playerFacts(mk({ value: 1.6, proj: 18, salary: 4500 }), ranks, null), 'e');
    expect(elite).toMatch(/18\.0|\$4,500|4\.00/);
    const q = blurb(playerFacts(mk({ status: 'Q', proj: 12.3 }), ranks, null), 'q');
    expect(q).toMatch(/Q|Questionable/);
    expect(q).toMatch(/12\.3/);
    expect(blurb(playerFacts(mk({ status: 'O' }), ranks, null), 'o')).toMatch(/Out/);
    const hot = mk({ value: 0.2, log: [1, 2, 3].map((w) => ({ week: 5 - w, opp: 'X', actual: 22, proj: 14, dnp: false, line: {} })) });
    expect(blurb(playerFacts(hot, null, null), 'h')).toMatch(/3 of his last 3|3 of 3/);
    const pricey = blurb(playerFacts(mk({ value: -1, salary: 9000, proj: 14 }), null, null), 'p');
    expect(pricey).toMatch(/\$9,000/);
  });

  it('ranks Vegas numbers against the slate', () => {
    const top = [...ranks.teams.values()].find((t) => t.impliedRank === 1)!;
    const p = mk({ team: top.team, opp: top.opp, game: top.game, value: 0.5 });
    const f = playerFacts(p, ranks, null);
    expect(f.teamTotal).toEqual({ value: top.implied, rank: 1, of: ranks.teamCount });
    expect(blurb(f, 's')).toMatch(/tops on the slate|best on the board|the highest total/);
  });

  it('short names', () => {
    expect(shortName({ name: 'Amon-Ra St. Brown', pos: 'WR', team: 'DET' })).toBe('St. Brown');
    expect(shortName({ name: 'Kenneth Walker III', pos: 'RB', team: 'SEA' })).toBe('Walker');
    expect(shortName({ name: 'Chiefs DST', pos: 'DST', team: 'KC' })).toBe('the Chiefs D');
  });
});
