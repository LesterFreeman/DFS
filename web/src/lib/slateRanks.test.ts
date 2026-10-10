import { expect, it } from 'vitest';
import type { Slate } from '../types';
import { slateRanks } from './slateRanks';

const slate = {
  games: [
    { game: 'CHI@GB', away: 'CHI', home: 'GB', kickoff: null, total: 45.5, spread: -1.5, implied: { GB: 22, CHI: 23.5 } },
    { game: 'BUF@MIA', away: 'BUF', home: 'MIA', kickoff: null, total: 51, spread: -7, implied: { MIA: 22, BUF: 29 } },
    { game: 'NE@NYJ', away: 'NE', home: 'NYJ', kickoff: null, total: 38, spread: 3, implied: { NYJ: 20.5, NE: 17.5 } },
    { game: 'X@Y', away: 'X', home: 'Y', kickoff: null }, // no lines yet
  ],
} as unknown as Slate;

it('ranks team totals, game totals, opponents and favorites across the slate', () => {
  const r = slateRanks(slate);
  expect(r.teamCount).toBe(6);
  expect(r.gameCount).toBe(3);
  const buf = r.teams.get('BUF')!;
  expect(buf).toMatchObject({ implied: 29, impliedRank: 1, margin: 7, favoriteRank: 1, opp: 'MIA' });
  expect(buf.share).toBeCloseTo(29 / 51);
  expect(r.teams.get('MIA')).toMatchObject({ margin: -7, favoriteRank: null });
  expect(r.teams.get('NE')!.impliedRank).toBe(6);
  expect(r.teams.get('NYJ')).toMatchObject({ oppImplied: 17.5, oppImpliedRank: 1, margin: 3, favoriteRank: 2 });
  expect(r.teams.get('GB')!.impliedRank).toBe(3); // ties (GB, MIA at 22) share the better rank
  expect(r.games.get('BUF@MIA')!.totalRank).toBe(1);
  expect(r.games.get('NE@NYJ')!.totalRank).toBe(3);
  expect(r.avgTotal).toBeCloseTo((45.5 + 51 + 38) / 3);
  expect(r.teams.has('X')).toBe(false);
});
