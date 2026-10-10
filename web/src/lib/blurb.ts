/**
 * The player panel's one-paragraph summary: stats-driven, 50 words or less, in a late-90s
 * highlight-show voice (big exclamations, sports-metaphor wordplay, deadpan asides).
 *
 *   playerFacts()  turns a player's numbers into labelled facts
 *   blurb()        picks the main story (opener), the strongest supporting fact, and a closing call
 *
 * Every claim comes from the data. Lines are chosen by a seed (player id + week), so a player's
 * summary is stable across reloads but players don't all read alike. Over 50 words, the closer is
 * dropped first, then the supporting line.
 */
import type { Player } from '../types';
import { ordinal } from './compare';
import type { SlateRanks } from './slateRanks';

export const MAX_WORDS = 50;

export interface Facts {
  name: string; // short name: last name, or "the Chiefs D"
  pos: string;
  team: string;
  opp: string;
  status: string;
  proj: number | null;
  salary: number;
  perK: number | null;
  valueTier: 'elite' | 'solid' | 'fair' | 'pricey' | null;
  form: { beat: number; of: number; gap: number } | null; // last up-to-4 graded games vs our projection
  matchup: { ease: 'easy' | 'average' | 'tough'; rank: number; teams: number; allowed: number } | null;
  teamTotal: { value: number; rank: number; of: number } | null;
  gameTotal: { value: number; rank: number; of: number } | null;
  oppTotal: { value: number; rank: number; of: number } | null; // rank 1 = lowest
  margin: number | null;
  tgtShare: number | null;
  tgt: number | null;
  car: number | null;
  tdShare: number | null;
  boom: boolean;
  steady: boolean;
  p10: number | null;
  p90: number | null;
}

const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/;

export function shortName(p: Pick<Player, 'name' | 'pos' | 'team'>): string {
  if (p.pos === 'DST') return `the ${p.name.replace(/\s*DST$/, '')} D`;
  const parts = p.name.replace(SUFFIX, '').split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : p.name;
}

export interface SimSummary {
  p10: number;
  p90: number;
}

export function playerFacts(p: Player & { value?: number | null }, ranks: SlateRanks | null, sim: SimSummary | null): Facts {
  const proj = p.proj;
  const v = p.value ?? null;
  const t = ranks?.teams.get(p.team);
  const g = p.game ? ranks?.games.get(p.game) : undefined;
  const graded = (p.log ?? []).filter((x) => !x.dnp && x.proj != null).slice(0, 4);
  const m = p.matchup;
  const ease = m ? (m.rank <= Math.ceil(m.teams / 4) ? 'easy' : m.rank > m.teams - Math.ceil(m.teams / 4) ? 'tough' : 'average') : null;
  const tdShare = p.td_pts != null && proj ? p.td_pts / proj : null;
  const ratio = sim && proj ? sim.p10 / proj : null;
  return {
    name: shortName(p),
    pos: p.pos,
    team: p.team,
    opp: p.opp ?? 'the opponent',
    status: p.status,
    proj,
    salary: p.salary,
    perK: proj != null ? proj / (p.salary / 1000) : null,
    valueTier: v == null ? null : v >= 1.2 ? 'elite' : v >= 0.4 ? 'solid' : v >= -0.4 ? 'fair' : 'pricey',
    form: graded.length >= 3
      ? { beat: graded.filter((x) => x.actual > x.proj!).length, of: graded.length,
          gap: graded.reduce((s, x) => s + x.actual - x.proj!, 0) / graded.length }
      : null,
    matchup: m && ease ? { ease, rank: m.rank, teams: m.teams, allowed: m.allowed } : null,
    teamTotal: t ? { value: t.implied, rank: t.impliedRank, of: ranks!.teamCount } : null,
    gameTotal: g ? { value: g.total, rank: g.totalRank, of: ranks!.gameCount } : null,
    oppTotal: t ? { value: t.oppImplied, rank: t.oppImpliedRank, of: ranks!.teamCount } : null,
    margin: t ? t.margin : null,
    tgtShare: p.pos !== 'QB' ? p.season_stats?.tgt_share ?? null : null,
    tgt: p.season_stats?.tgt ?? null,
    car: p.season_stats?.car ?? null,
    tdShare,
    boom: (tdShare != null && tdShare >= 0.35) || (p.cv != null && p.cv >= 0.75),
    steady: ratio != null && ratio >= 0.45 && (p.cv == null || p.cv < 0.55),
    p10: sim?.p10 ?? null,
    p90: sim?.p90 ?? null,
  };
}

// ---------- wording helpers ----------
const n1 = (x: number) => x.toFixed(1);
const money = (x: number) => `$${x.toLocaleString('en-US')}`;
const pctx = (x: number) => `${Math.round(x * 100)}%`;
const lowRank = (rank: number, of: number) => of - rank + 1; // rank from the bottom
/** "the stingiest" for rank 1, else "3rd-stingiest". */
const nth = (rank: number, word: string) => (rank === 1 ? `the ${word}` : `${ordinal(rank)}-${word}`);
/** 7 not 7.0; 6.5 stays. */
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

type Line = (f: Facts) => string;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = (lines: Line[], seed: number, slot: number): Line => lines[(seed + slot * 7919) % lines.length];

// ---------- openers (the main story) ----------
const BENCH: Line[] = [
  (f) => `${cap(f.name)} is listed ${statusWord(f.status)}. Riding the pine this week, folks. Nothing to see here; please move along to the next highlight.`,
  (f) => `${cap(f.name)} is ${statusWord(f.status)}. You can't score from the bench, and believe me, people have tried.`,
];
const NO_PROJ: Line[] = [
  (f) => `No projection for ${f.name} this week. Even the experts have nothing to say, and that never happens.`,
];
const QUESTIONABLE: Line[] = [
  (f) => `${cap(f.name)} carries a Q tag into the weekend, so check the news before lock. If he suits up, he projects ${n1(f.proj!)}.`,
  (f) => `Questionable! ${cap(f.name)} is a game-time decision waiting to happen. Healthy, he's a ${n1(f.proj!)}-point guy.`,
];
const ELITE: Line[] = [
  (f) => `Clearance-rack alert! ${cap(f.name)} projects ${n1(f.proj!)} for just ${money(f.salary)}. Somebody call price check on aisle five.`,
  (f) => `${cap(f.name)} is priced like a backup and projected like a headliner: ${f.perK!.toFixed(2)} points per grand. That's grand larceny.`,
  (f) => `At ${money(f.salary)}, ${f.name} is the kind of bargain that makes the cashier double-check the tag. ${n1(f.proj!)} projected points.`,
];
const SMASH: Line[] = [
  (f) => `Oh, the oddsmakers see fireworks! ${f.team} is implied for ${n1(f.teamTotal!.value)}, ${f.teamTotal!.rank === 1 ? 'tops' : ordinal(f.teamTotal!.rank)} on the slate, and ${f.name} is holding the matches.`,
  (f) => `${cap(f.name)} draws ${f.opp} in a game Vegas pegs at ${n1(f.gameTotal!.value)}, ${f.gameTotal!.rank === 1 ? 'the highest total on the slate' : `the slate's ${nth(f.gameTotal!.rank, 'highest')} total`}. Turn the volume up.`,
];
const HEATER: Line[] = [
  (f) => `Somebody check ${f.name} for a fever: over our projection in ${f.form!.beat} of his last ${f.form!.of}, by ${n1(f.form!.gap)} a game. Hotter than July asphalt.`,
  (f) => `${cap(f.name)} keeps blowing past the number: ${f.form!.beat} of ${f.form!.of} games over projection. The man has the heat check on speed dial.`,
];
const COLD: Line[] = [
  (f) => `${cap(f.name)} has come up short of our projection ${f.form!.of} straight games, by ${n1(-f.form!.gap)} a week. The thermostat is set to meat locker.`,
  (f) => `Brrr. ${cap(f.name)} has missed his number in all of his last ${f.form!.of}. Somebody get that man a space heater.`,
];
const PRICEY: Line[] = [
  (f) => `Paying ${money(f.salary)} for ${n1(f.proj!)} projected points? That's airport-sandwich pricing, my friend.`,
  (f) => `${cap(f.name)} costs ${money(f.salary)} and projects ${n1(f.proj!)}: a luxury sedan with minivan mileage.`,
];
const DST_OPEN: Line[] = [
  (f) => `${cap(f.name)} draws ${f.opp}, implied for just ${n1(f.oppTotal!.value)}, ${nth(f.oppTotal!.rank, 'lowest')} total on the slate. Quarterbacks, take note.`,
  (f) => `${cap(f.name)} gets ${f.opp}, a team Vegas expects to score ${n1(f.oppTotal!.value)}. That's not an offense, that's a suggestion.`,
];
const SOLID: Line[] = [
  (f) => `${cap(f.name)} is the meat-and-potatoes play: ${n1(f.proj!)} projected for ${money(f.salary)}, no garnish required.`,
  (f) => `Nothing flashy, nothing scary: ${f.name} projects ${n1(f.proj!)} at ${money(f.salary)}, the reliable four-door sedan of the ${f.pos} position.`,
  (f) => `${cap(f.name)} at ${money(f.salary)}: ${n1(f.proj!)} projected, ${f.perK!.toFixed(2)} points per grand. Right down the middle, like a well-struck extra point.`,
];

// ---------- supporting facts (the strongest one that isn't the opener's story) ----------
type Support = { key: string; when: (f: Facts) => boolean; lines: Line[] };
const SUPPORT: Support[] = [
  { key: 'teamTop', when: (f) => !!f.teamTotal && f.teamTotal.rank <= 3 && f.pos !== 'DST', lines: [
    (f) => `Vegas has ${f.team} at ${n1(f.teamTotal!.value)}, ${ordinal(f.teamTotal!.rank)} of ${f.teamTotal!.of} on the slate.`,
    (f) => `The bookies like ${f.team} for ${n1(f.teamTotal!.value)} points, ${f.teamTotal!.rank === 1 ? 'best' : `${ordinal(f.teamTotal!.rank)}-best`} on the board.`,
  ] },
  { key: 'teamLow', when: (f) => !!f.teamTotal && lowRank(f.teamTotal.rank, f.teamTotal.of) <= 3 && f.pos !== 'DST', lines: [
    (f) => `Vegas has ${f.team} at just ${n1(f.teamTotal!.value)}, ${nth(lowRank(f.teamTotal!.rank, f.teamTotal!.of), 'lowest')} on the slate. Pack a lunch.`,
  ] },
  { key: 'gameTop', when: (f) => !!f.gameTotal && f.gameTotal.rank === 1, lines: [
    (f) => `His game has the slate's top over/under at ${n1(f.gameTotal!.value)}. Bring popcorn.`,
  ] },
  { key: 'gameLow', when: (f) => !!f.gameTotal && lowRank(f.gameTotal.rank, f.gameTotal.of) <= 2 && f.pos !== 'DST', lines: [
    (f) => `His game's total is ${n1(f.gameTotal!.value)}, ${nth(lowRank(f.gameTotal!.rank, f.gameTotal!.of), 'lowest')} of ${f.gameTotal!.of}. That's a rock fight.`,
  ] },
  { key: 'easy', when: (f) => f.matchup?.ease === 'easy' && f.pos !== 'DST', lines: [
    (f) => `${f.opp} gives up ${n1(f.matchup!.allowed)} a game to ${f.pos}s, ${nth(f.matchup!.rank, 'most')} in the league. Welcome mat: out.`,
    (f) => `And the defense? ${f.opp} allows ${n1(f.matchup!.allowed)} a game to ${f.pos}s. Not so much a wall as a beaded curtain.`,
  ] },
  { key: 'tough', when: (f) => f.matchup?.ease === 'tough' && f.pos !== 'DST', lines: [
    (f) => `${f.opp} allows just ${n1(f.matchup!.allowed)} a game to ${f.pos}s, ${nth(lowRank(f.matchup!.rank, f.matchup!.teams), 'stingiest')}. Brick wall, meet forehead.`,
  ] },
  { key: 'hog', when: (f) => f.tgtShare != null && f.tgtShare >= 0.25, lines: [
    (f) => `He's eating ${pctx(f.tgtShare!)} of his team's targets, about ${n1(f.tgt ?? 0)} a game. Pass the gravy.`,
  ] },
  { key: 'workhorse', when: (f) => f.car != null && f.car >= 18, lines: [
    (f) => `${n1(f.car!)} carries a game: the man punches the clock and then punches the defense.`,
  ] },
  { key: 'favored', when: (f) => f.margin != null && f.margin >= 7 && f.pos !== 'QB', lines: [
    (f) => `${f.team} is favored by ${num(f.margin!)}: the kind of game script where somebody gets fed late.`,
  ] },
  { key: 'boom', when: (f) => f.boom && f.tdShare != null, lines: [
    (f) => `${pctx(f.tdShare!)} of his projection rides on touchdowns, so it's boom or bust, baby.`,
  ] },
  { key: 'steady', when: (f) => f.steady && f.p10 != null, lines: [
    (f) => `His simulated floor is ${n1(f.p10!)}, steady as a metronome in a library.`,
  ] },
];

// ---------- closers (the call) ----------
const CLOSE_LOCK: Line[] = [() => 'Cash-game lock. Pencil him in, in pen.', () => 'Plug him in and go make a sandwich.'];
const CLOSE_GPP: Line[] = [
  (f) => (f.p90 != null ? `Ceiling of ${n1(f.p90)}, basement included: tournament stuff.` : 'Tournament swing for the fences.'),
  () => 'Swing for the fences in tournaments; maybe not your cash lineup.',
];
const CLOSE_FADE: Line[] = [() => 'Unless he goes off, that salary is a speed bump. Fade.', () => 'Pay up somewhere else.'];
const CLOSE_FILL: Line[] = [() => 'Fine filler if the salary fits.', () => 'Not a must, not a miss.'];
const CLOSE_Q: Line[] = [() => 'Have a backup plan ready.'];
const CLOSE_SPOT: Line[] = [() => 'Great spot, ugly price tag. Tournaments only.', () => 'Love the spot, hate the sticker. Tournament play.'];

function statusWord(s: string): string {
  return s === 'O' ? 'Out' : s === 'IR' ? 'on injured reserve' : s === 'D' ? 'Doubtful' : s;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The summary paragraph (50 words or less). */
export function blurb(f: Facts, seedKey: string): string {
  const seed = hash(seedKey);
  if (['O', 'IR', 'D'].includes(f.status)) return pick(BENCH, seed, 0)(f);
  if (f.proj == null) return pick(NO_PROJ, seed, 0)(f);

  let story: string;
  let opener: Line[];
  const smash = (f.teamTotal && f.teamTotal.rank <= 3 && f.pos !== 'DST') || f.gameTotal?.rank === 1;
  if (f.status === 'Q') [story, opener] = ['q', QUESTIONABLE];
  else if (f.pos === 'DST' && f.oppTotal && f.oppTotal.rank <= 5) [story, opener] = ['dst', DST_OPEN];
  else if (f.valueTier === 'elite') [story, opener] = ['elite', ELITE];
  else if (smash && f.matchup?.ease !== 'tough') {
    story = 'smash';
    opener = f.teamTotal && f.teamTotal.rank <= 3 && f.pos !== 'DST' ? [SMASH[0]] : [SMASH[1]];
  } else if (f.form && f.form.beat === f.form.of) [story, opener] = ['heater', HEATER];
  else if (f.form && f.form.beat === 0) [story, opener] = ['cold', COLD];
  else if (f.valueTier === 'pricey') [story, opener] = ['pricey', PRICEY];
  else [story, opener] = ['solid', SOLID];

  const used = story === 'smash' ? (f.teamTotal && f.teamTotal.rank <= 3 ? 'teamTop' : 'gameTop') : '';
  const support = SUPPORT.find((s) => s.key !== used && s.when(f) && !(story === 'smash' && (s.key === 'teamTop' || s.key === 'gameTop')));
  const closer = story === 'q' ? CLOSE_Q
    : story === 'smash' && f.valueTier === 'pricey' ? CLOSE_SPOT
      : f.valueTier === 'pricey' || story === 'cold' ? CLOSE_FADE
      : f.boom ? CLOSE_GPP
        : f.valueTier === 'elite' || (f.valueTier === 'solid' && f.steady) ? CLOSE_LOCK
          : CLOSE_FILL;

  const parts = [pick(opener, seed, 1)(f), support ? pick(support.lines, seed, 2)(f) : '', pick(closer, seed, 3)(f)].filter(Boolean);
  // Over the limit: drop the closer first, then the supporting line.
  while (parts.length > 1 && wordCount(parts.join(' ')) > MAX_WORDS) parts.splice(parts.length === 3 ? 2 : 1, 1);
  return parts.join(' ');
}
