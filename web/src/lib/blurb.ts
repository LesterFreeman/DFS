/**
 * The player panel's one-paragraph summary: stats-driven, 50 words or less, in a late-90s
 * highlight-show voice (big exclamations, sports-metaphor wordplay, deadpan asides, mock
 * play-by-play).
 *
 *   playerFacts()  turns a player's numbers into labelled facts (season, last game, Vegas, matchup,
 *                  usage, position ranks, simulation)
 *   storyOf()      scores ~28 storylines for the player and picks the strongest
 *   blurb()        opener for that story + the two strongest supporting facts that don't repeat it
 *                  + a closing call; over 50 words, the second support, then the closer, then the
 *                  first support are dropped
 *   buildField()   position ranks for the slate and a per-story rotation index, so players who share
 *                  a storyline get different wording before any repeats
 *
 * Every claim comes from the data. A player's summary is stable for the week (seeded by id + week).
 */
import type { Player, Pos } from '../types';
import { ordinal } from './compare';
import type { SlateRanks } from './slateRanks';

export const MAX_WORDS = 50;

export interface FieldInfo {
  projRank: number; // 1 = highest projection at his position on the slate
  projOf: number;
  salaryRank: number; // 1 = priciest at his position
  salaryOf: number;
  rotation: number; // index among this week's players sharing his storyline
}

export interface SimSummary {
  p10: number;
  p90: number;
  pPace?: number;
}

export interface Facts {
  id: string;
  name: string; // short name: last name, or "the Chiefs D"
  pos: Pos;
  team: string;
  opp: string;
  home: boolean | null;
  status: string;
  proj: number | null;
  salary: number;
  perK: number | null;
  value: number | null;
  posRank: number | null;
  valueTier: 'elite' | 'solid' | 'fair' | 'pricey' | null;
  floor: number | null; // pipeline floor (20th percentile)
  form: { beat: number; of: number; gap: number } | null; // last up-to-4 graded games vs our projection
  last: { pts: number; opp: string | null; week: number; line: string | null; vsProj: number | null } | null;
  best: { pts: number; opp: string | null; week: number } | null;
  avg: number | null;
  games: number;
  games20: number;
  histGames: number;
  matchup: { ease: 'easy' | 'average' | 'tough'; rank: number; teams: number; allowed: number } | null;
  teamTotal: { value: number; rank: number; of: number } | null;
  gameTotal: { value: number; rank: number; of: number } | null;
  oppTotal: { value: number; rank: number; of: number } | null; // rank 1 = lowest
  margin: number | null;
  share: number | null; // team share of game points
  tgtShare: number | null;
  tgt: number | null;
  car: number | null;
  tdShare: number | null;
  cv: number | null;
  split: { lo: number; hi: number } | null; // sources disagree
  primetime: string | null; // "Sunday" / "Monday" / "Thursday"
  late: boolean;
  p10: number | null;
  p90: number | null;
  pPace: number | null;
  needs: number | null; // points needed for salary pace at T = 150
  field: FieldInfo | null;
}

const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/;

export function shortName(p: Pick<Player, 'name' | 'pos' | 'team'>): string {
  if (p.pos === 'DST') return `the ${p.name.replace(/\s*DST$/, '')} D`;
  const parts = p.name.replace(SUFFIX, '').split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : p.name;
}

/** "9 catches for 98 yards and a TD" etc. Null when there's nothing worth quoting. */
export function statLine(pos: Pos, l: Record<string, number | undefined>): string | null {
  const td = (n?: number) => (n ? (n === 1 ? ' and a TD' : ` and ${n} TDs`) : '');
  if (pos === 'QB' && l.pass_yd) {
    const rush = l.rush_td ? `, plus ${l.rush_td} rushing TD${l.rush_td > 1 ? 's' : ''}` : '';
    return `${l.pass_yd} passing yards and ${l.pass_td ?? 0} TD${(l.pass_td ?? 0) === 1 ? '' : 's'}${rush}`;
  }
  if (pos === 'RB' && (l.car || l.rec)) {
    const parts = [`${l.car ?? 0} carries for ${l.rush_yd ?? 0} yards${td(l.rush_td)}`];
    if (l.rec && l.rec >= 3) parts.push(`${l.rec} catches`);
    return parts.join(' with ');
  }
  if ((pos === 'WR' || pos === 'TE') && l.rec != null) {
    return `${l.rec} catch${l.rec === 1 ? '' : 'es'} for ${l.rec_yd ?? 0} yards${td(l.rec_td)}`;
  }
  return null;
}

function primetimeDay(kickoff: string | null): string | null {
  if (!kickoff) return null;
  const d = new Date(kickoff);
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d));
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/New_York' }).format(d);
  return hour >= 19 ? day : null;
}

export function playerFacts(p: Player & { value?: number | null; posRank?: number | null }, ranks: SlateRanks | null,
  sim: SimSummary | null, field: FieldInfo | null = null, targetTotal = 150): Facts {
  const proj = p.proj;
  const v = p.value ?? null;
  const t = ranks?.teams.get(p.team);
  const g = p.game ? ranks?.games.get(p.game) : undefined;
  const log = p.log ?? [];
  const played = log.filter((x) => !x.dnp);
  const graded = played.filter((x) => x.proj != null).slice(0, 4);
  const m = p.matchup;
  const ease = m ? (m.rank <= Math.ceil(m.teams / 4) ? 'easy' : m.rank > m.teams - Math.ceil(m.teams / 4) ? 'tough' : 'average') : null;
  const last = played[0];
  const best = played.reduce<typeof played[0] | undefined>((a, b) => (!a || b.actual > a.actual ? b : a), undefined);
  return {
    id: p.id,
    name: shortName(p),
    pos: p.pos,
    team: p.team,
    opp: p.opp ?? 'the opponent',
    home: p.home,
    status: p.status,
    proj,
    salary: p.salary,
    perK: proj != null ? proj / (p.salary / 1000) : null,
    value: v,
    posRank: p.posRank ?? null,
    valueTier: v == null ? null : v >= 1.2 ? 'elite' : v >= 0.4 ? 'solid' : v >= -0.4 ? 'fair' : 'pricey',
    floor: p.floor,
    form: graded.length >= 3
      ? { beat: graded.filter((x) => x.actual > x.proj!).length, of: graded.length,
          gap: graded.reduce((s, x) => s + x.actual - x.proj!, 0) / graded.length }
      : null,
    last: last ? { pts: last.actual, opp: last.opp, week: last.week, line: statLine(p.pos, last.line),
                   vsProj: last.proj != null ? last.actual - last.proj : null } : null,
    best: best ? { pts: best.actual, opp: best.opp, week: best.week } : null,
    avg: p.season_stats?.avg ?? null,
    games: p.season_stats?.games ?? 0,
    games20: p.season_stats?.games_20 ?? 0,
    histGames: p.hist_games,
    matchup: m && ease ? { ease, rank: m.rank, teams: m.teams, allowed: m.allowed } : null,
    teamTotal: t ? { value: t.implied, rank: t.impliedRank, of: ranks!.teamCount } : null,
    gameTotal: g ? { value: g.total, rank: g.totalRank, of: ranks!.gameCount } : null,
    oppTotal: t ? { value: t.oppImplied, rank: t.oppImpliedRank, of: ranks!.teamCount } : null,
    margin: t ? t.margin : null,
    share: t?.share ?? null,
    tgtShare: p.pos !== 'QB' ? p.season_stats?.tgt_share ?? null : null,
    tgt: p.season_stats?.tgt ?? null,
    car: p.season_stats?.car ?? null,
    tdShare: p.td_pts != null && proj ? p.td_pts / proj : null,
    cv: p.cv,
    split: proj && p.n_sources >= 2 && p.proj_sd != null && p.proj_sd / proj >= 0.15 && p.proj_min != null && p.proj_max != null
      ? { lo: p.proj_min, hi: p.proj_max } : null,
    primetime: primetimeDay(p.kickoff),
    late: p.late,
    p10: sim?.p10 ?? null,
    p90: sim?.p90 ?? null,
    pPace: sim?.pPace ?? null,
    needs: (p.salary * targetTotal) / 50000,
    field,
  };
}

// ---------- wording helpers ----------
const n1 = (x: number) => x.toFixed(1);
const money = (x: number) => `$${x.toLocaleString('en-US')}`;
const pctx = (x: number) => `${Math.round(x * 100)}%`;
const lowRank = (rank: number, of: number) => of - rank + 1;
/** "the stingiest" for rank 1, else "3rd-stingiest". */
const nth = (rank: number, word: string) => (rank === 1 ? `the ${word}` : `${ordinal(rank)}-${word}`);
/** 7 not 7.0; 6.5 stays. */
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const POS_PL: Record<string, string> = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', DST: 'defenses' };

type Line = (f: Facts) => string | null; // null = this variant needs a fact the player doesn't have

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pick a variant that works for this player; `index` decides which. */
function choose(lines: Line[], f: Facts, index: number): string | null {
  const ok = lines.map((l) => l(f)).filter((x): x is string => !!x);
  return ok.length ? ok[((index % ok.length) + ok.length) % ok.length] : null;
}

// ---------- storylines (openers) ----------
// Each: when it applies, how strong it is, which supporting facts it already covers, and its openers.
interface Story {
  key: string;
  score: (f: Facts) => number; // 0 = doesn't apply
  covers: string[];
  lines: Line[];
}

const P = (f: Facts) => n1(f.proj ?? 0);
const S = (f: Facts) => money(f.salary);
const N = (f: Facts) => cap(f.name);
const projRankPhrase = (f: Facts) => (f.field ? (f.field.projRank === 1 ? 'top' : `${ordinal(f.field.projRank)}-best`) : null);

export const STORIES: Story[] = [
  { key: 'bench', covers: [], score: (f) => (['O', 'IR', 'D'].includes(f.status) ? 100 : 0), lines: [
    (f) => `${N(f)} is listed ${statusWord(f.status)}. Riding the pine this week, folks. Nothing to see here; please move along to the next highlight.`,
    (f) => `${N(f)} is ${statusWord(f.status)}. You can't score from the bench, and believe me, people have tried.`,
    (f) => `${N(f)} is ${statusWord(f.status)} this week. Zero snaps, zero points, zero reasons to roster him.`,
    (f) => `Scratch ${f.name} off the list: ${statusWord(f.status)}. Check back next week.`,
  ] },
  { key: 'noproj', covers: [], score: (f) => (f.proj == null ? 99 : 0), lines: [
    (f) => `No projection for ${f.name} this week. Even the experts have nothing to say, and that never happens.`,
    (f) => `${N(f)} has no projection this week, which is the experts' polite way of saying "pass."`,
  ] },
  { key: 'questionable', covers: [], score: (f) => (f.status === 'Q' ? 50 : 0), lines: [
    (f) => `${N(f)} carries a Q tag into the weekend, so check the news before lock. If he suits up, he projects ${P(f)}.`,
    (f) => `Questionable! ${N(f)} is a game-time decision waiting to happen. Healthy, he's a ${P(f)}-point guy.`,
    (f) => `Status: Questionable. ${N(f)} projects ${P(f)} if he plays, so keep one eye on the inactive list.`,
    (f) => `${N(f)} has a Q next to his name. The ${P(f)}-point projection assumes he plays; the news will tell us.`,
    (f) => `Paging the training room: ${f.name} is Questionable, with ${P(f)} projected if he gives it a go.`,
  ] },
  { key: 'elite', covers: ['value'], score: (f) => (f.value != null && f.value >= 1.2 ? 2 + (f.value - 1.2) : 0), lines: [
    (f) => `Clearance-rack alert! ${N(f)} projects ${P(f)} for just ${S(f)}. Somebody call price check on aisle five.`,
    (f) => `${N(f)} is priced like a backup and projected like a headliner: ${f.perK!.toFixed(2)} points per grand. That's grand larceny.`,
    (f) => `At ${S(f)}, ${f.name} is the kind of bargain that makes the cashier double-check the tag. ${P(f)} projected.`,
    (f) => `Somebody tell DraftKings they forgot a digit: ${f.name} at ${S(f)}, projecting ${P(f)}.`,
    (f) => `${N(f)}, ${S(f)}, ${P(f)} projected. That's not a salary, that's a coupon.`,
    (f) => (f.posRank ? `Value city, population: ${f.name}. ${f.perK!.toFixed(2)} points per $1K makes him ${nth(f.posRank, 'best')} value at ${f.pos}.` : null),
    (f) => `${N(f)} at ${S(f)} is the free refill of this slate: ${P(f)} projected, and you barely paid for the cup.`,
    (f) => `Is that a typo, or is ${f.name} really ${S(f)}? His ${P(f)}-point projection says: not a typo, friend.`,
  ] },
  { key: 'punt', covers: ['value', 'salary'],
    score: (f) => (f.field && f.field.salaryRank >= f.field.salaryOf - 3 && (f.value ?? 0) >= 0.3 && f.pos !== 'DST' ? 2.2 : 0), lines: [
    (f) => `Bargain bin, aisle one: ${f.name} costs ${S(f)} and still projects ${P(f)}. Salary relief, delivered.`,
    (f) => `${N(f)} at ${S(f)} is the minimum-wage hire who shows up early: ${P(f)} projected.`,
    (f) => `Need cap space? ${N(f)} at ${S(f)} frees it up and still brings ${P(f)} projected points to the party.`,
    (f) => `${N(f)} is the punt play with a pulse: ${S(f)}, ${P(f)} projected.`,
    (f) => `Penny-stock watch: ${f.name}, ${S(f)}, ${f.perK!.toFixed(2)} points per grand.`,
    (f) => `The cheap seats have a view: ${f.name} at ${S(f)} projects ${P(f)}.`,
  ] },
  { key: 'pricey', covers: ['value'],
    score: (f) => (f.value == null || f.value >= -0.4 ? 0
      : !f.field || f.field.salaryRank <= 10 ? 1.6 + (-0.4 - f.value) : 1.05 + 0.5 * (-0.4 - f.value)), lines: [
    (f) => `Paying ${S(f)} for ${P(f)} projected points? That's airport-sandwich pricing, my friend.`,
    (f) => `${N(f)} costs ${S(f)} and projects ${P(f)}: a luxury sedan with minivan mileage.`,
    (f) => (f.field ? `${N(f)} is the ${nth(f.field.salaryRank, 'priciest')} ${f.pos} on the slate but only the ${nth(f.field.projRank, 'best')} projection. Math is undefeated.` : null),
    (f) => (f.needs != null ? `At ${S(f)}, ${f.name} needs ${num(Math.round(f.needs))} points to pay rent. He projects ${P(f)}. The landlord is not amused.` : null),
    (f) => `${N(f)} at ${S(f)}: good player, bad price. It happens to the best of us, and to our wallets.`,
    (f) => `Sticker shock! ${N(f)} runs ${S(f)} for a ${P(f)}-point projection.`,
    (f) => `${N(f)} at ${S(f)} is a steakhouse price for a diner projection (${P(f)}).`,
  ] },
  { key: 'smash', covers: ['teamTop', 'easy'],
    score: (f) => (f.teamTotal && f.teamTotal.rank <= 3 && f.pos !== 'DST' && f.matchup?.ease !== 'tough' ? 2 + (4 - f.teamTotal.rank) * 0.15 : 0), lines: [
    (f) => `Oh, the oddsmakers see fireworks! ${f.team} is implied for ${n1(f.teamTotal!.value)}, ${f.teamTotal!.rank === 1 ? 'tops' : ordinal(f.teamTotal!.rank)} on the slate, and ${f.name} is holding the matches.`,
    (f) => `Vegas has ${f.team} scoring ${n1(f.teamTotal!.value)}, ${f.teamTotal!.rank === 1 ? 'the most on the slate' : `${ordinal(f.teamTotal!.rank)}-most on the slate`}. ${N(f)} is first in line at the buffet.`,
    (f) => `${N(f)} gets ${f.opp} with ${f.team} implied for ${n1(f.teamTotal!.value)}. Somebody alert the scoreboard operator.`,
    (f) => `Points are on the menu: ${f.team} at ${n1(f.teamTotal!.value)} implied, and ${f.name} is the house special.`,
    (f) => `The bookies expect ${f.team} to put up ${n1(f.teamTotal!.value)}. ${N(f)} should have a seat at that table.`,
    (f) => `If you like touchdowns, ${f.team}'s ${n1(f.teamTotal!.value)}-point team total is your kind of party, and ${f.name} brought the dip.`,
  ] },
  { key: 'shootout', covers: ['gameTop'],
    score: (f) => (f.gameTotal && f.gameTotal.rank <= 2 && f.pos !== 'DST' ? 1.85 - (f.gameTotal.rank - 1) * 0.15 : 0), lines: [
    (f) => `${N(f)} draws ${f.opp} in a game Vegas pegs at ${n1(f.gameTotal!.value)}, ${f.gameTotal!.rank === 1 ? 'the highest total on the slate' : `the slate's ${nth(f.gameTotal!.rank, 'highest')} total`}. Turn the volume up.`,
    (f) => `Bring popcorn: ${f.name}'s game has an over/under of ${n1(f.gameTotal!.value)}, ${f.gameTotal!.rank === 1 ? 'best on the slate' : '2nd-best on the slate'}.`,
    (f) => `The over/under is ${n1(f.gameTotal!.value)}, and ${f.name} is right in the middle of it. Defense optional.`,
    (f) => `${n1(f.gameTotal!.value)} points expected in ${f.name}'s game. Scoreboard operators, stretch those fingers.`,
    (f) => `Shootout alert! ${f.team} vs ${f.opp} carries a ${n1(f.gameTotal!.value)} total, and ${f.name} has a front-row seat.`,
  ] },
  { key: 'slog', covers: ['gameLow', 'teamLow'],
    score: (f) => (f.gameTotal && lowRank(f.gameTotal.rank, f.gameTotal.of) <= 2 && f.pos !== 'DST' ? 1.5 : 0), lines: [
    (f) => `${N(f)} is stuck in a rock fight: ${n1(f.gameTotal!.value)} total, ${nth(lowRank(f.gameTotal!.rank, f.gameTotal!.of), 'lowest')} on the slate.`,
    (f) => `Low-scoring forecast: ${f.name}'s game sits at ${n1(f.gameTotal!.value)}. Bring a lunch pail and a flashlight.`,
    (f) => `Vegas sees ${n1(f.gameTotal!.value)} points in ${f.name}'s game. That's a field-goal festival waiting to happen.`,
    (f) => `${N(f)} plays in ${nth(lowRank(f.gameTotal!.rank, f.gameTotal!.of), 'lowest')}-total game on the slate (${n1(f.gameTotal!.value)}). Points will be rationed.`,
  ] },
  { key: 'favoredRB', covers: ['favored'], score: (f) => (f.pos === 'RB' && f.margin != null && f.margin >= 6 ? 1.7 : 0), lines: [
    (f) => `${f.team} is favored by ${num(f.margin!)}, and big favorites feed their running backs late. ${N(f)} is the beneficiary.`,
    (f) => `Lead early, run the clock: ${f.team} is a ${num(f.margin!)}-point favorite, and ${f.name} holds the stopwatch.`,
    (f) => `Game-script alert! ${f.team} by ${num(f.margin!)} means plenty of fourth-quarter carries for ${f.name}.`,
    (f) => `${N(f)} on a ${num(f.margin!)}-point favorite? That's a recipe for a bucket of carries.`,
  ] },
  { key: 'underdogPass', covers: ['underdog'],
    score: (f) => ((f.pos === 'WR' || f.pos === 'TE') && f.margin != null && f.margin <= -6 ? 1.5 : 0), lines: [
    (f) => `${f.team} is a ${num(-f.margin!)}-point underdog, and trailing teams throw. ${N(f)} should see plenty of footballs.`,
    (f) => `Down big? Throw it to ${f.name}. ${f.team} is getting ${num(-f.margin!)} points, so the air raid could be on.`,
    (f) => `Garbage time is still time: ${f.team} is a ${num(-f.margin!)}-point dog, and ${f.name} catches the overflow.`,
  ] },
  { key: 'primetime', covers: ['primetime'], score: (f) => (f.primetime && f.pos !== 'DST' ? 1.2 : 0), lines: [
    (f) => `Lights, camera, ${f.name}! He plays under the ${f.primetime}-night lights against ${f.opp}, projecting ${P(f)}.`,
    (f) => `${N(f)} gets the ${f.primetime}-night stage against ${f.opp}. ${P(f)} projected, and late-swap insurance included.`,
    (f) => `Primetime player alert: ${f.name} vs ${f.opp} on ${f.primetime} night, ${P(f)} projected.`,
    (f) => `The whole country gets to watch ${f.name} on ${f.primetime} night. ${P(f)} projected against ${f.opp}.`,
  ] },
  { key: 'heater', covers: ['form'], score: (f) => (f.form && f.form.beat === f.form.of ? 2.1 : 0), lines: [
    (f) => `Somebody check ${f.name} for a fever: over our projection in ${f.form!.beat} of his last ${f.form!.of}, by ${n1(f.form!.gap)} a game.`,
    (f) => `${N(f)} keeps blowing past the number: ${f.form!.beat} of ${f.form!.of} games over projection. Hotter than July asphalt.`,
    (f) => `Stop me if you've heard this: ${f.name} beat his projection again. That's ${f.form!.beat} of ${f.form!.of}, by ${n1(f.form!.gap)} a game.`,
    (f) => `${N(f)} has been cooking: +${n1(f.form!.gap)} a game against our projections lately. Somebody grab the fire extinguisher.`,
    (f) => `Projection? ${N(f)} treats it like a suggestion: over it in ${f.form!.beat} straight.`,
  ] },
  { key: 'cold', covers: ['form'], score: (f) => (f.form && f.form.beat === 0 ? 2.0 : 0), lines: [
    (f) => `${N(f)} has come up short of our projection ${f.form!.of} straight games, by ${n1(-f.form!.gap)} a week. The thermostat is set to meat locker.`,
    (f) => `Brrr. ${N(f)} has missed his number in all of his last ${f.form!.of}. Somebody get that man a space heater.`,
    (f) => `${N(f)} and his projections have not been on speaking terms: ${f.form!.of} misses in a row.`,
    (f) => `Cold front moving through: ${f.name} is ${n1(-f.form!.gap)} points a game under projection lately.`,
  ] },
  { key: 'bounce', covers: ['last', 'avg'],
    score: (f) => (f.last?.vsProj != null && f.last.vsProj <= -7 && f.avg != null && f.proj != null && f.avg >= f.proj ? 1.9 : 0), lines: [
    (f) => `Last week ${f.name} put up ${n1(f.last!.pts)}${f.last!.opp ? ` vs ${f.last!.opp}` : ''}. Throw it out: he averages ${n1(f.avg!)} this season.`,
    (f) => `${N(f)} laid an egg last week (${n1(f.last!.pts)}), but his ${n1(f.avg!)}-point average says the hen is still laying.`,
    (f) => `Bounce-back watch: ${f.name} managed ${n1(f.last!.pts)} last time out. His ${n1(f.avg!)} average says that was the exception.`,
    (f) => `One bad week does not a season make. ${N(f)}: ${n1(f.last!.pts)} last week, ${n1(f.avg!)} on the year.`,
  ] },
  { key: 'breakout', covers: ['last'],
    score: (f) => (f.last && f.avg != null && f.games >= 2 && f.last.pts >= 20 && f.last.pts >= f.avg * 1.5 ? 1.9 : 0), lines: [
    (f) => (f.last!.line ? `${N(f)} went off for ${n1(f.last!.pts)}${f.last!.opp ? ` vs ${f.last!.opp}` : ''}: ${f.last!.line}. Can he do it again?` : null),
    (f) => (f.last!.line ? `Did you see ${f.name} last week? ${cap(f.last!.line)}, ${n1(f.last!.pts)} points. The highlight reel needed overtime.` : null),
    (f) => `${N(f)} dropped ${n1(f.last!.pts)} on ${f.last!.opp ?? 'his last opponent'} last week. That's the number to beat now.`,
    (f) => (f.last!.line ? `Breakout or blip? ${N(f)} just posted ${n1(f.last!.pts)} on ${f.last!.line}.` : null),
  ] },
  { key: 'ceiling', covers: ['twenty'], score: (f) => (f.games >= 3 && f.games20 / f.games >= 0.66 ? 1.7 : 0), lines: [
    (f) => `${N(f)} has 20-plus points in ${f.games20} of ${f.games} games. That's a habit, not a fluke.`,
    (f) => `Twenty-point club, member in good standing: ${f.name}, ${f.games20} of ${f.games} games.`,
    (f) => `${N(f)} keeps clearing 20: ${f.games20} times in ${f.games} tries this season.`,
  ] },
  { key: 'hog', covers: ['hog'], score: (f) => (f.tgtShare != null && f.tgtShare >= 0.27 ? 1.8 : 0), lines: [
    (f) => `${N(f)} is eating ${pctx(f.tgtShare!)} of his team's targets, about ${n1(f.tgt ?? 0)} a game. Pass the gravy.`,
    (f) => `Target-hog alert: ${f.name} gets ${pctx(f.tgtShare!)} of the looks. The other receivers fight for scraps.`,
    (f) => `${n1(f.tgt ?? 0)} targets a game for ${f.name}. The quarterback knows his name, his number and his favorite route.`,
    (f) => `${N(f)} sees ${pctx(f.tgtShare!)} of the targets. When in doubt, throw it to the guy who's always open.`,
  ] },
  { key: 'workhorse', covers: ['workhorse'], score: (f) => (f.car != null && f.car >= 18 ? 1.8 : 0), lines: [
    (f) => `${n1(f.car!)} carries a game: ${f.name} punches the clock and then punches the defense.`,
    (f) => `Feed the man: ${f.name} averages ${n1(f.car!)} carries. That's not a committee, that's a monarchy.`,
    (f) => `${N(f)} is a workhorse: ${n1(f.car!)} carries a game and no plans to share.`,
    (f) => `Bell-cow alert! ${N(f)} sees ${n1(f.car!)} carries a game, and volume is king.`,
  ] },
  { key: 'tdDependent', covers: ['boom'], score: (f) => (f.tdShare != null && f.tdShare >= 0.4 && f.pos !== 'QB' ? 1.4 : 0), lines: [
    (f) => `${pctx(f.tdShare!)} of ${f.name}'s projection rides on touchdowns. Boom or bust, baby, and both are on the table.`,
    (f) => `${N(f)} lives in the end zone: ${pctx(f.tdShare!)} of his points are expected from touchdowns.`,
    (f) => `${N(f)} is a touchdown-or-bust proposition: ${pctx(f.tdShare!)} of the projection is six-pointers.`,
  ] },
  { key: 'steady', covers: ['floor'],
    score: (f) => (f.floor != null && f.proj && f.floor / f.proj >= 0.55 && f.pos !== 'DST' ? 1.3 : 0), lines: [
    (f) => `${N(f)} is steady as a metronome in a library: a ${n1(f.floor!)} floor on a ${P(f)} projection.`,
    (f) => `Mr. Reliable: ${f.name} projects ${P(f)} with a floor of ${n1(f.floor!)}. Boring? Sure. Profitable? Also sure.`,
    (f) => `${N(f)} doesn't do drama: ${P(f)} projected, ${n1(f.floor!)} floor.`,
  ] },
  { key: 'chalk', covers: ['projRank'],
    score: (f) => (f.field && f.pos !== 'DST' ? (f.field.projRank === 1 ? 1.9 : f.field.projRank <= 3 ? 1.35 : 0) : 0), lines: [
    (f) => `${N(f)} owns the ${projRankPhrase(f)} ${f.pos} projection on the slate at ${P(f)}. Chalk, but chalk for a reason.`,
    (f) => (f.field!.projRank === 1 ? `The top of the ${f.pos} board belongs to ${f.name}: ${P(f)} projected.` : `${N(f)} sits near the top of the ${f.pos} board: ${P(f)} projected, ${projRankPhrase(f)}.`),
    (f) => `Everybody's going to play ${f.name}, and here's why: ${P(f)} projected, ${projRankPhrase(f)} at ${f.pos}.`,
    (f) => `${N(f)} is ${f.field!.projRank === 1 ? 'the' : 'a'} headliner at ${f.pos} this week: ${P(f)} projected for ${S(f)}.`,
  ] },
  { key: 'split', covers: ['split'], score: (f) => (f.split ? 1.45 : 0), lines: [
    (f) => `The experts can't agree on ${f.name}: projections run from ${n1(f.split!.lo)} to ${n1(f.split!.hi)}. Somebody's going to be wrong.`,
    (f) => `${N(f)} splits the panel: ${n1(f.split!.lo)} on the low end, ${n1(f.split!.hi)} on the high end.`,
    (f) => `Ask four experts about ${f.name}, get four answers: anywhere from ${n1(f.split!.lo)} to ${n1(f.split!.hi)}.`,
  ] },
  { key: 'thin', covers: [], score: (f) => (f.histGames < 4 && f.pos !== 'DST' ? 1.25 : 0), lines: [
    (f) => `${N(f)} is new around here: ${f.histGames} game${f.histGames === 1 ? '' : 's'} of history, so the ${P(f)} projection is part science, part tea leaves.`,
    (f) => `Small sample, big question mark: ${f.name} projects ${P(f)} on just ${f.histGames} game${f.histGames === 1 ? '' : 's'} of track record.`,
  ] },
  { key: 'dstSoft', covers: ['oppTotal'], score: (f) => (f.pos === 'DST' && f.oppTotal && f.oppTotal.rank <= 5 ? 2.2 : 0), lines: [
    (f) => `${N(f)} draws ${f.opp}, implied for just ${n1(f.oppTotal!.value)}, ${nth(f.oppTotal!.rank, 'lowest')} total on the slate. Quarterbacks, take note.`,
    (f) => `${N(f)} gets ${f.opp}, a team Vegas expects to score ${n1(f.oppTotal!.value)}. That's not an offense, that's a suggestion.`,
    (f) => `${f.opp} is implied for ${n1(f.oppTotal!.value)}, and ${f.name} should be licking its chops.`,
    (f) => `Feeding time: ${f.name} draws the ${f.opp} offense, which Vegas expects to score ${n1(f.oppTotal!.value)}.`,
    (f) => `${N(f)} gets ${f.opp}, ${nth(f.oppTotal!.rank, 'lowest')} team total on the slate. Sacks and turnovers are on the menu.`,
  ] },
  { key: 'dstTough', covers: ['oppTotal'],
    score: (f) => (f.pos === 'DST' && f.oppTotal && lowRank(f.oppTotal.rank, f.oppTotal.of) <= 5 ? 1.8 : 0), lines: [
    (f) => `${N(f)} draws ${f.opp}, implied for ${n1(f.oppTotal!.value)}. That's a lot of points to keep off the board.`,
    (f) => `Tough day at the office: ${f.opp} is implied for ${n1(f.oppTotal!.value)} against ${f.name}.`,
    (f) => `${N(f)} vs the ${f.opp} offense, projected for ${n1(f.oppTotal!.value)}? Strap in.`,
  ] },
  { key: 'dstFav', covers: ['favored'], score: (f) => (f.pos === 'DST' && f.margin != null && f.margin >= 6 ? 1.7 : 0), lines: [
    (f) => `${f.team} is favored by ${num(f.margin!)}, so ${f.name} gets to chase a team playing from behind. Sacks love company.`,
    (f) => `Big favorite, big pass-rush opportunity: ${f.team} by ${num(f.margin!)}, and ${f.name} pins its ears back.`,
    (f) => `When you're up ${num(f.margin!)} (as Vegas expects), the other guys have to throw. ${N(f)} says thank you.`,
  ] },
  { key: 'dstSolid', covers: ['oppTotal'], score: (f) => (f.pos === 'DST' ? 1.0 : 0), lines: [
    (f) => `${N(f)} vs ${f.opp}: ${P(f)} projected at ${S(f)}. A defense that clocks in and clocks out.`,
    (f) => (f.oppTotal ? `${N(f)} draws ${f.opp} (implied for ${n1(f.oppTotal.value)}). Middle of the road, but the road is paved.` : null),
    (f) => `${N(f)} projects ${P(f)} at ${S(f)}. Not a lockdown special, not a sieve.`,
    (f) => `Defense wins championships; ${f.name} wins about ${P(f)} points this week, at ${S(f)}.`,
  ] },
  { key: 'solid', covers: [], score: () => 1.0, lines: [
    (f) => `${N(f)} is the meat-and-potatoes play: ${P(f)} projected for ${S(f)}, no garnish required.`,
    (f) => `Nothing flashy, nothing scary: ${f.name} projects ${P(f)} at ${S(f)}, the reliable four-door sedan of the ${f.pos} position.`,
    (f) => `${N(f)} at ${S(f)}: ${P(f)} projected, ${f.perK!.toFixed(2)} points per grand. Right down the middle, like a well-struck extra point.`,
    (f) => `${N(f)}: ${P(f)} projected at ${S(f)}. Not flashy, not scary, just ball.`,
    (f) => `Meet ${f.name}, the utility player of your lineup: ${P(f)} projected for ${S(f)}.`,
    (f) => `${N(f)} at ${S(f)} projects ${P(f)}. Not the headline, but he'll make the highlights package.`,
    (f) => `File ${f.name} under "solid citizen": ${P(f)} projected, ${f.perK!.toFixed(2)} points per grand.`,
  ] },
];

function statusWord(s: string): string {
  return s === 'O' ? 'Out' : s === 'IR' ? 'on injured reserve' : s === 'D' ? 'Doubtful' : s;
}

/** The strongest storyline; near-ties (within 10%) are broken by the seed. */
export function storyOf(f: Facts, seed: number): Story {
  const scored = STORIES.map((s) => ({ s, v: s.score(f) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const top = scored[0].v;
  const close = scored.filter((x) => x.v >= top * 0.9);
  return close[seed % close.length].s;
}

// ---------- supporting facts ----------
interface Support {
  key: string;
  score: (f: Facts) => number;
  lines: Line[];
}

const SUPPORTS: Support[] = [
  { key: 'last', score: (f) => (f.last?.line ? 1.15 : 0), lines: [
    (f) => `Last week${f.last!.opp ? ` vs ${f.last!.opp}` : ''}: ${f.last!.line}, ${n1(f.last!.pts)} points.`,
    (f) => `He's coming off ${f.last!.line}${f.last!.opp ? ` against ${f.last!.opp}` : ''}.`,
    (f) => `Last time out: ${n1(f.last!.pts)} points on ${f.last!.line}.`,
  ] },
  { key: 'best', score: (f) => (f.best && f.best.pts >= 20 && f.games >= 2 ? 0.85 : 0), lines: [
    (f) => `His season high: ${n1(f.best!.pts)}${f.best!.opp ? ` vs ${f.best!.opp}` : ''} in Week ${f.best!.week}.`,
    (f) => `He's shown the ceiling already: ${n1(f.best!.pts)} in Week ${f.best!.week}.`,
  ] },
  { key: 'avg', score: (f) => (f.avg != null && f.proj != null && f.games >= 2 && Math.abs(f.avg - f.proj) >= 3 ? 1.0 : 0), lines: [
    (f) => (f.avg! > f.proj! ? `He averages ${n1(f.avg!)} this season, above this week's ${P(f)} projection.` : `Heads up: he averages just ${n1(f.avg!)} this season.`),
    (f) => (f.avg! > f.proj! ? `His ${n1(f.avg!)}-point season average says the projection might be light.` : `His ${n1(f.avg!)}-point average says the projection is generous.`),
  ] },
  { key: 'projRank', score: (f) => (f.field && f.field.projRank <= 3 && f.pos !== 'DST' ? 1.1 : 0), lines: [
    (f) => `That's the ${projRankPhrase(f)} ${f.pos} projection on the slate.`,
    (f) => (f.field!.projRank === 1 ? `Nobody at ${f.pos} projects higher.` : `Only ${f.field!.projRank === 2 ? 'one' : 'two'} ${f.pos}${f.field!.projRank === 2 ? '' : 's'} project${f.field!.projRank === 2 ? 's' : ''} higher.`),
  ] },
  { key: 'salary', score: (f) => (f.field && (f.field.salaryRank <= 2 || f.field.salaryRank >= f.field.salaryOf - 2) ? 0.8 : 0), lines: [
    (f) => (f.field!.salaryRank <= 2 ? `He's ${nth(f.field!.salaryRank, 'priciest')} ${f.pos} on the slate.` : `He's one of the cheapest ${POS_PL[f.pos]} on the board.`),
  ] },
  { key: 'teamTop', score: (f) => (f.teamTotal && f.teamTotal.rank <= 3 && f.pos !== 'DST' ? 1.3 : 0), lines: [
    (f) => `Vegas has ${f.team} at ${n1(f.teamTotal!.value)}, ${f.teamTotal!.rank === 1 ? 'tops' : `${ordinal(f.teamTotal!.rank)} of ${f.teamTotal!.of}`} on the slate.`,
    (f) => `The bookies like ${f.team} for ${n1(f.teamTotal!.value)} points, ${f.teamTotal!.rank === 1 ? 'best' : `${ordinal(f.teamTotal!.rank)}-best`} on the board.`,
    (f) => `${f.team}'s ${n1(f.teamTotal!.value)}-point team total ranks ${ordinal(f.teamTotal!.rank)} this week.`,
  ] },
  { key: 'teamLow', score: (f) => (f.teamTotal && lowRank(f.teamTotal.rank, f.teamTotal.of) <= 3 && f.pos !== 'DST' ? 1.2 : 0), lines: [
    (f) => `Vegas has ${f.team} at just ${n1(f.teamTotal!.value)}, ${nth(lowRank(f.teamTotal!.rank, f.teamTotal!.of), 'lowest')} on the slate. Pack a lunch.`,
    (f) => `${f.team} is implied for only ${n1(f.teamTotal!.value)}. Points will be hard to come by.`,
  ] },
  { key: 'gameTop', score: (f) => (f.gameTotal && f.gameTotal.rank === 1 ? 1.2 : 0), lines: [
    (f) => `His game has the slate's top over/under at ${n1(f.gameTotal!.value)}. Bring popcorn.`,
    (f) => `It's the highest-total game on the slate (${n1(f.gameTotal!.value)}).`,
  ] },
  { key: 'gameLow', score: (f) => (f.gameTotal && lowRank(f.gameTotal.rank, f.gameTotal.of) <= 2 && f.pos !== 'DST' ? 1.1 : 0), lines: [
    (f) => `His game's total is ${n1(f.gameTotal!.value)}, ${nth(lowRank(f.gameTotal!.rank, f.gameTotal!.of), 'lowest')} of ${f.gameTotal!.of}. That's a rock fight.`,
    (f) => `Only ${n1(f.gameTotal!.value)} points expected in his game. Defense, defense, defense.`,
  ] },
  { key: 'easy', score: (f) => (f.matchup?.ease === 'easy' && f.pos !== 'DST' ? 1.3 : 0), lines: [
    (f) => `${f.opp} gives up ${n1(f.matchup!.allowed)} a game to ${POS_PL[f.pos]}, ${nth(f.matchup!.rank, 'most')} in the league. Welcome mat: out.`,
    (f) => `And the defense? ${f.opp} allows ${n1(f.matchup!.allowed)} a game to ${POS_PL[f.pos]}. Not so much a wall as a beaded curtain.`,
    (f) => `${f.opp} has been generous to ${POS_PL[f.pos]}: ${n1(f.matchup!.allowed)} points a game.`,
    (f) => `Matchup gift: ${f.opp} hands ${POS_PL[f.pos]} ${n1(f.matchup!.allowed)} points a game.`,
    (f) => `${f.opp}'s defense against ${POS_PL[f.pos]}? ${n1(f.matchup!.allowed)} points a game allowed. Come on in, the water's warm.`,
  ] },
  { key: 'tough', score: (f) => (f.matchup?.ease === 'tough' && f.pos !== 'DST' ? 1.3 : 0), lines: [
    (f) => `${f.opp} allows just ${n1(f.matchup!.allowed)} a game to ${POS_PL[f.pos]}, ${nth(lowRank(f.matchup!.rank, f.matchup!.teams), 'stingiest')}. Brick wall, meet forehead.`,
    (f) => `The bad news: ${f.opp} gives up only ${n1(f.matchup!.allowed)} a game to ${POS_PL[f.pos]}.`,
    (f) => `${f.opp} has locked down ${POS_PL[f.pos]} all year (${n1(f.matchup!.allowed)} a game).`,
    (f) => `Tough draw: ${f.opp} holds ${POS_PL[f.pos]} to ${n1(f.matchup!.allowed)} a game.`,
    (f) => `${f.opp} treats ${POS_PL[f.pos]} like uninvited guests: ${n1(f.matchup!.allowed)} points a game allowed.`,
  ] },
  { key: 'hog', score: (f) => (f.tgtShare != null && f.tgtShare >= 0.24 ? 1.2 : 0), lines: [
    (f) => `He's eating ${pctx(f.tgtShare!)} of his team's targets, about ${n1(f.tgt ?? 0)} a game. Pass the gravy.`,
    (f) => `${pctx(f.tgtShare!)} target share: the quarterback knows where he lives.`,
    (f) => `He sees ${n1(f.tgt ?? 0)} targets a game. Volume pays the bills.`,
  ] },
  { key: 'workhorse', score: (f) => (f.car != null && f.car >= 16 ? 1.2 : 0), lines: [
    (f) => `${n1(f.car!)} carries a game: the man punches the clock and then punches the defense.`,
    (f) => `He averages ${n1(f.car!)} carries. Volume is a beautiful thing.`,
  ] },
  { key: 'favored', score: (f) => (f.margin != null && f.margin >= 6 && f.pos !== 'QB' && f.pos !== 'DST' ? 1.0 : 0), lines: [
    (f) => `${f.team} is favored by ${num(f.margin!)}: the kind of game script where somebody gets fed late.`,
    (f) => `${f.team} is a ${num(f.margin!)}-point favorite. Good teams, good things.`,
  ] },
  { key: 'underdog', score: (f) => ((f.pos === 'WR' || f.pos === 'TE') && f.margin != null && f.margin <= -6 ? 0.9 : 0), lines: [
    (f) => `${f.team} is a ${num(-f.margin!)}-point underdog, which usually means a lot of passing.`,
  ] },
  { key: 'primetime', score: (f) => (f.primetime ? 0.75 : 0), lines: [
    (f) => `He plays under the ${f.primetime}-night lights.`,
    (f) => `${f.primetime}-night kickoff, so he's late-swap friendly.`,
  ] },
  { key: 'share', score: (f) => (f.share != null && f.share >= 0.56 && f.pos !== 'DST' ? 0.8 : 0), lines: [
    (f) => `${f.team} is expected to score ${pctx(f.share!)} of the game's points.`,
  ] },
  { key: 'pace', score: (f) => (f.pPace != null && f.needs != null ? 0.95 : 0), lines: [
    (f) => `He needs ${num(Math.round(f.needs!))} points to pay off his salary; he gets there ${pctx(f.pPace!)} of the time.`,
    (f) => `Salary pace is ${num(Math.round(f.needs!))} points; our simulations get him there ${pctx(f.pPace!)} of the time.`,
  ] },
  { key: 'ceilingFact', score: (f) => (f.p90 != null && f.proj && f.p90 / f.proj >= 1.7 ? 0.9 : 0), lines: [
    (f) => `On a great day (1 in 10), he hits ${n1(f.p90!)}.`,
    (f) => `His ceiling: ${n1(f.p90!)} in his best 1 in 10 games.`,
  ] },
  { key: 'floor', score: (f) => (f.p10 != null && f.proj && f.p10 / f.proj >= 0.45 ? 0.9 : 0), lines: [
    (f) => `Even a bad day (1 in 10) is ${n1(f.p10!)}.`,
    (f) => `His simulated floor is ${n1(f.p10!)}, steady as a metronome in a library.`,
  ] },
  { key: 'boom', score: (f) => (f.tdShare != null && f.tdShare >= 0.35 ? 1.0 : 0), lines: [
    (f) => `${pctx(f.tdShare!)} of his projection rides on touchdowns, so it's boom or bust, baby.`,
    (f) => `${pctx(f.tdShare!)} of the projection is touchdowns. Live by the end zone, die by the end zone.`,
  ] },
  { key: 'split', score: (f) => (f.split ? 1.0 : 0), lines: [
    (f) => `The sources range from ${n1(f.split!.lo)} to ${n1(f.split!.hi)} on him.`,
  ] },
  { key: 'twenty', score: (f) => (f.games >= 3 && f.games20 >= 2 ? 0.85 : 0), lines: [
    (f) => `He has ${f.games20} games of 20-plus points this season.`,
  ] },
  { key: 'oppTotal', score: (f) => (f.pos === 'DST' && f.oppTotal ? 1.1 : 0), lines: [
    (f) => `${f.opp} is implied for ${n1(f.oppTotal!.value)}, ${f.oppTotal!.rank <= f.oppTotal!.of / 2 ? nth(f.oppTotal!.rank, 'lowest') : nth(lowRank(f.oppTotal!.rank, f.oppTotal!.of), 'highest')} of ${f.oppTotal!.of}.`,
  ] },
];

// ---------- closers ----------
const CLOSERS: Record<string, Line[]> = {
  q: [() => 'Have a backup plan ready.', () => 'Check the inactives, then decide.', () => 'Keep a pivot in your back pocket.',
    () => 'Monitor, monitor, monitor.', () => 'Refresh the news feed before you lock it in.', () => 'Plan B, meet Plan A.',
    () => 'Game-time decisions call for game-time decisions.'],
  spot: [() => 'Great spot, ugly price tag. Tournaments only.', () => 'Love the spot, hate the sticker. Tournament play.',
    () => 'The spot says yes; the wallet says maybe. Tournaments.', () => 'Pay for the spot in tournaments, save the money in cash games.',
    () => 'A tournament splurge, not a cash-game must.'],
  fade: [() => 'Unless he goes off, that salary is a speed bump. Fade.', () => 'Pay up somewhere else.',
    () => 'Let somebody else pay for that.', () => 'Pass, politely.', () => 'Admire from afar this week.',
    () => 'Your salary has better places to be.', () => 'Hard pass at that price.', () => 'Not this week, my friend.',
    () => 'Save your money; the projection isn\'t buying what that salary is selling.'],
  punt: [() => 'Plug him in and spend the savings on a stud.', () => 'Cheap points are still points.',
    () => 'Salary saver, lineup enabler.', () => 'The money you save buys a superstar.', () => 'Budget play with upside.',
    () => 'The cheapest way to fit your studs.'],
  stack: [(f) => `Stack him with his ${f.pos === 'QB' ? 'receivers' : 'quarterback'} and enjoy the show.`,
    () => 'Prime stacking material.', () => 'Pair him with his quarterback in tournaments.',
    (f) => (f.pos === 'QB' ? 'Bring a receiver along for the ride.' : 'Stack him and let the points pile up.'),
    () => 'Stack it, pack it, ship it.'],
  gpp: [(f) => (f.p90 != null ? `Ceiling of ${n1(f.p90)}, basement included: tournament stuff.` : null),
    () => 'Swing for the fences in tournaments; maybe not your cash lineup.', () => 'Tournament dart with a big target.',
    () => 'High risk, high reward. Bring a helmet.', () => 'A tournament flier, not a cash-game anchor.',
    () => 'Boom-or-bust, emphasis on boom in tournaments.', () => 'Roll the dice in tournaments.',
    () => 'Big-field tournaments love a guy like this.'],
  lock: [() => 'Cash-game lock. Pencil him in, in pen.', () => 'Plug him in and go make a sandwich.',
    () => 'Lock it in and don\'t look back.', () => 'Cash-game cornerstone. Build around him.', () => 'Easy call. Next question.',
    () => 'Write it down in ink.', () => 'This is the easy part of your lineup.', () => 'Start here and build out.'],
  fill: [() => 'Fine filler if the salary fits.', () => 'Not a must, not a miss.', () => 'Playable. Not urgent.',
    () => 'A fine piece, not the centerpiece.', () => 'He\'ll do the job if the math works.', () => 'Solid if you need the salary slot.',
    () => 'A reasonable choice, not a revelation.', () => 'Use him to make the numbers work.', () => 'Middle of the pack, and that\'s okay.'],
};

function closerKey(f: Facts, story: string): string | null {
  if (story === 'bench' || story === 'noproj') return null;
  if (story === 'questionable') return 'q';
  if ((story === 'smash' || story === 'shootout') && f.valueTier === 'pricey') return 'spot';
  if (f.valueTier === 'pricey' || story === 'cold') return 'fade';
  if (story === 'punt') return 'punt';
  if ((f.pos === 'QB' || f.pos === 'WR' || f.pos === 'TE') && f.teamTotal && f.teamTotal.rank <= 3 && f.valueTier !== 'elite') return 'stack';
  if (story !== 'steady' && ((f.tdShare != null && f.tdShare >= 0.35) || (f.cv != null && f.cv >= 0.75))) return 'gpp';
  if (f.valueTier === 'elite' || (f.valueTier === 'solid' && f.floor != null && f.proj && f.floor / f.proj >= 0.5)) return 'lock';
  return 'fill';
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The summary paragraph (50 words or less). */
export function blurb(f: Facts, seedKey: string): string {
  const seed = hash(seedKey);
  const story = storyOf(f, seed);
  const opener = choose(story.lines, f, f.field ? f.field.rotation + hash(story.key + seedKey.split('-').pop()) : seed)
    ?? choose(STORIES.find((s) => s.key === 'solid')!.lines, f, seed)!;
  if (story.key === 'bench' || story.key === 'noproj') return opener;

  const supports = SUPPORTS.filter((s) => !story.covers.includes(s.key) && s.score(f) > 0)
    .sort((a, b) => b.score(f) - a.score(f) || (hash(a.key + seedKey) % 7) - (hash(b.key + seedKey) % 7))
    .slice(0, 2)
    .map((s, i) => choose(s.lines, f, hash(seedKey + s.key) + i))
    .filter((x): x is string => !!x);
  const ck = closerKey(f, story.key);
  const closer = ck ? choose(CLOSERS[ck], f, hash(`${seedKey}:close`)) : null;

  // Over the limit: drop the second support, then the closer, then the first support.
  const tries: (string | null)[][] = [
    [opener, supports[0], supports[1], closer],
    [opener, supports[0], closer],
    [opener, supports[0]],
    [opener, closer],
    [opener],
  ];
  for (const t of tries) {
    const text = t.filter(Boolean).join(' ');
    if (wordCount(text) <= MAX_WORDS) return f.pos === 'DST' ? itForDefense(text) : text;
  }
  return opener;
}

/** Defenses are "it", not "he". */
function itForDefense(text: string): string {
  return text.replace(/\bHe's\b/g, "It's").replace(/\bhe's\b/g, "it's").replace(/\bHe\b/g, 'It').replace(/\bhe\b/g, 'it')
    .replace(/\bHis\b/g, 'Its').replace(/\bhis\b/g, 'its').replace(/\bhim\b/g, 'it');
}

/** Position ranks and per-story rotation for everyone on the slate (computed once per slate). */
export function buildField(players: (Player & { value?: number | null; posRank?: number | null })[],
  ranks: SlateRanks | null, week: number): Map<string, FieldInfo> {
  const out = new Map<string, FieldInfo>();
  const projected = players.filter((p) => p.proj != null && p.in_pool);
  const byPos = new Map<string, typeof projected>();
  for (const p of projected) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p]);
  for (const group of byPos.values()) {
    const byProj = [...group].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    const bySal = [...group].sort((a, b) => b.salary - a.salary);
    for (const p of group) {
      out.set(p.id, { projRank: byProj.indexOf(p) + 1, projOf: group.length, salaryRank: bySal.indexOf(p) + 1,
        salaryOf: group.length, rotation: 0 });
    }
  }
  // Rotation: players sharing a storyline take that story's variants in turn.
  const byStory = new Map<string, string[]>();
  for (const p of projected) {
    const f = playerFacts(p, ranks, null, out.get(p.id) ?? null);
    const s = storyOf(f, hash(`${p.id}-${week}`)).key;
    byStory.set(s, [...(byStory.get(s) ?? []), p.id]);
  }
  for (const ids of byStory.values()) {
    ids.sort((a, b) => hash(`${a}-${week}`) - hash(`${b}-${week}`));
    ids.forEach((id, i) => (out.get(id)!.rotation = i));
  }
  return out;
}
