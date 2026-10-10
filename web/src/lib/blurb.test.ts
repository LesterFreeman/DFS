import { describe, expect, it } from 'vitest';
import sample from '../../public/data/players.json';
import slateJson from '../../public/data/slate.json';
import type { GameLogEntry, Player, Slate } from '../types';
import { blurb, buildField, MAX_WORDS, playerFacts, shortName, statLine, STORIES, storyOf, wordCount, type Facts } from './blurb';
import { slateRanks } from './slateRanks';
import { computeValues } from './value';

const players = computeValues(sample as unknown as Player[]);
const slate = slateJson as unknown as Slate;
const ranks = slateRanks(slate);
const field = buildField(players, ranks, slate.week);

// A neutral player in a game without lines, so only the facts each test sets drive the story.
function mk(over: Partial<Player> & { value?: number | null; posRank?: number | null }): Player & { value: number | null } {
  return {
    id: 'x1', name: 'Joe Test', pos: 'WR', team: 'AAA', opp: 'BBB', home: true, game: 'BBB@AAA', kickoff: null,
    late: false, salary: 6000, status: 'ACTIVE', status_detail: {}, status_conflict: false, projections: {},
    n_sources: 3, missing_sources: [], proj: 15, proj_sd: 1, proj_min: 14, proj_max: 16, td_pts: 3,
    team_total: null, opp_total: null, match: {}, floor: 7, sigma: 8, cv: 0.5, hist_games: 10, hist_mean: 15,
    in_pool: true, value: 0, ...over,
  };
}
const game = (week: number, actual: number, proj: number | null, line: GameLogEntry['line'] = {}, opp = 'PIT'): GameLogEntry =>
  ({ week, opp, actual, proj, dnp: false, line });
const facts = (p: ReturnType<typeof mk>, extra: Partial<Facts> = {}) => ({ ...playerFacts(p, null, null), ...extra });
const story = (f: Facts) => storyOf(f, 1).key;

describe('guardrails', () => {
  it('stays within 50 words, without placeholders, for every sample player', () => {
    for (const p of players) {
      const text = blurb(playerFacts(p, ranks, { p10: (p.proj ?? 0) * 0.5, p90: (p.proj ?? 0) * 1.8, pPace: 0.4 }, field.get(p.id) ?? null),
        `${p.id}-${slate.week}`);
      expect(wordCount(text), text).toBeLessThanOrEqual(MAX_WORDS);
      expect(text).not.toMatch(/undefined|NaN|null|Infinity|\[object/);
      expect(text).toMatch(/[.!?]$/);
    }
  });

  it('is deterministic for a player and week', () => {
    const f = facts(mk({ value: 1.5 }));
    expect(blurb(f, 'a-5')).toBe(blurb(f, 'a-5'));
  });

  it('every storyline has at least 2 openers, and the library is large', () => {
    for (const s of STORIES) expect(s.lines.length, s.key).toBeGreaterThanOrEqual(2);
    expect(STORIES.length).toBeGreaterThanOrEqual(25);
    expect(STORIES.reduce((n, s) => n + s.lines.length, 0)).toBeGreaterThanOrEqual(110);
  });
});

describe('storylines fire for the player built for them, with his numbers', () => {
  it('status', () => {
    expect(blurb(facts(mk({ status: 'O' })), 'o')).toMatch(/Out/);
    const q = blurb(facts(mk({ status: 'Q', proj: 12.3 })), 'q');
    expect(q).toMatch(/Q|Questionable/);
    expect(q).toMatch(/12\.3/);
  });

  it('value: elite, punt, overpriced', () => {
    const elite = facts(mk({ value: 1.8, proj: 18, salary: 4500 }));
    expect(story(elite)).toBe('elite');
    const punt = facts(mk({ value: 0.6, proj: 9, salary: 3000 }), {
      field: { projRank: 30, projOf: 40, salaryRank: 39, salaryOf: 40, rotation: 0 } });
    expect(story(punt)).toBe('punt');
    expect(blurb(punt, 'p')).toMatch(/\$3,000/);
    const pricey = facts(mk({ value: -1.2, salary: 9000, proj: 14 }));
    expect(story(pricey)).toBe('pricey');
    expect(blurb(pricey, 'p')).toMatch(/\$9,000|9,000/);
  });

  it('form: heater, cold, bounce-back, breakout, ceiling games', () => {
    const hot = mk({ log: [game(4, 22, 14), game(3, 20, 14), game(2, 19, 14)] });
    expect(story(facts(hot))).toBe('heater');
    const cold = mk({ log: [game(4, 6, 14), game(3, 7, 14), game(2, 8, 14)] });
    expect(story(facts(cold))).toBe('cold');
    const bounce = mk({ proj: 15, log: [game(4, 3.1, 15)], season_stats: { games: 4, avg: 18.2, tgt: 8, car: 0, tgt_share: 0.2, games_20: 1 } });
    const fb = facts(bounce);
    expect(story(fb)).toBe('bounce');
    expect(blurb(fb, 'b')).toMatch(/3\.1/);
    expect(blurb(fb, 'b')).toMatch(/18\.2/);
    const boom = mk({ log: [game(4, 31.8, 14, { rec: 9, rec_yd: 148, rec_td: 2 }, 'MIA')],
      season_stats: { games: 4, avg: 14, tgt: 8, car: 0, tgt_share: 0.2, games_20: 1 } });
    const fo = facts(boom);
    expect(story(fo)).toBe('breakout');
    expect(blurb(fo, 'x')).toMatch(/31\.8|148/);
    const ceiling = mk({ season_stats: { games: 4, avg: 22, tgt: 8, car: 0, tgt_share: 0.2, games_20: 3 } });
    expect(story(facts(ceiling))).toBe('ceiling');
  });

  it('role: target hog, workhorse, touchdown-dependent, steady, chalk', () => {
    const hog = facts(mk({ season_stats: { games: 4, avg: 15, tgt: 10.5, car: 0, tgt_share: 0.31, games_20: 1 } }));
    expect(story(hog)).toBe('hog');
    expect(blurb(hog, 'h')).toMatch(/31%|10\.5/);
    const work = facts(mk({ pos: 'RB', season_stats: { games: 4, avg: 15, tgt: 3, car: 21.5, tgt_share: 0.08, games_20: 1 } }));
    expect(story(work)).toBe('workhorse');
    expect(blurb(work, 'w')).toMatch(/21\.5/);
    expect(story(facts(mk({ td_pts: 7.5, proj: 15 })))).toBe('tdDependent');
    expect(story(facts(mk({ floor: 10, proj: 15 })))).toBe('steady');
    const chalk = facts(mk({}), { field: { projRank: 1, projOf: 40, salaryRank: 2, salaryOf: 40, rotation: 0 } });
    expect(story(chalk)).toBe('chalk');
  });

  it('uncertainty: sources split, thin history', () => {
    const split = facts(mk({ proj: 12, proj_sd: 3, proj_min: 7.5, proj_max: 17.2 }));
    expect(story(split)).toBe('split');
    expect(blurb(split, 's')).toMatch(/7\.5/);
    expect(story(facts(mk({ hist_games: 1 })))).toBe('thin');
  });

  it('Vegas and game context, ranked against the slate', () => {
    const top = [...ranks.teams.values()].find((t) => t.impliedRank === 1)!;
    const p = mk({ team: top.team, opp: top.opp, game: top.game, value: 0.5 });
    const f = playerFacts(p, ranks, null);
    expect(f.teamTotal).toEqual({ value: top.implied, rank: 1, of: ranks.teamCount });
    expect(['smash', 'shootout']).toContain(story(f));
    expect(blurb(f, 's')).toMatch(new RegExp(top.implied.toFixed(1).replace('.', '\\.')));
    const fav = facts(mk({ pos: 'RB' }), { margin: 9.5 });
    expect(story(fav)).toBe('favoredRB');
    expect(blurb(fav, 'f')).toMatch(/9\.5/);
    expect(story(facts(mk({ pos: 'WR' }), { margin: -8 }))).toBe('underdogPass');
    expect(story(facts(mk({ kickoff: '2026-10-12T00:20:00Z' })))).toBe('primetime');
  });

  it('DSTs', () => {
    const d = mk({ pos: 'DST', name: 'Chiefs DST' });
    expect(story(facts(d, { oppTotal: { value: 15.5, rank: 1, of: 26 } }))).toBe('dstSoft');
    expect(story(facts(d, { oppTotal: { value: 29, rank: 26, of: 26 } }))).toBe('dstTough');
    expect(story(facts(d, { margin: 7 }))).toBe('dstFav');
    expect(blurb(facts(d), 'd')).toMatch(/the Chiefs D/i);
  });
});

describe('variety across the slate', () => {
  it('players sharing a storyline get different openers before any repeat', () => {
    const openers = new Map<string, Map<string, number>>();
    for (const p of players.filter((x) => x.in_pool)) {
      const fi = field.get(p.id)!;
      const f = playerFacts(p, ranks, null, fi);
      const s = storyOf(f, 0).key;
      const first = blurb(f, `${p.id}-${slate.week}`).split(/(?<=[.!?])\s/)[0];
      const m = openers.get(s) ?? new Map();
      m.set(first, (m.get(first) ?? 0) + 1);
      openers.set(s, m);
    }
    const all = [...openers.values()].flatMap((m) => [...m.values()]);
    const total = all.reduce((a, b) => a + b, 0);
    expect(Math.max(...all) / total).toBeLessThanOrEqual(0.12); // no single opening sentence dominates
    expect(openers.size).toBeGreaterThanOrEqual(6); // several storylines on a small sample slate
  });
});

it('short names and stat lines', () => {
  expect(shortName({ name: 'Amon-Ra St. Brown', pos: 'WR', team: 'DET' })).toBe('St. Brown');
  expect(shortName({ name: 'Kenneth Walker III', pos: 'RB', team: 'SEA' })).toBe('Walker');
  expect(shortName({ name: 'Chiefs DST', pos: 'DST', team: 'KC' })).toBe('the Chiefs D');
  expect(statLine('WR', { rec: 9, rec_yd: 98, rec_td: 1, tgt: 12 })).toBe('9 catches for 98 yards and a TD');
  expect(statLine('RB', { car: 20, rush_yd: 99, rush_td: 2, rec: 7 })).toBe('20 carries for 99 yards and 2 TDs with 7 catches');
  expect(statLine('QB', { pass_yd: 253, pass_td: 1, rush_td: 1 })).toBe('253 passing yards and 1 TD, plus 1 rushing TD');
});
