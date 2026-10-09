/**
 * Player comparison: who is most likely to score the most this week, and why.
 *
 * Uses the same calibrated, correlated simulation as the lineup modes (sim.ts), run on just the
 * selected players, so teammates and opponents keep their real-world links (a QB and his receiver
 * rise together; two receivers on one team share targets; a defense suffers when the offense it
 * faces does well).
 */
import type { Player } from '../types';
import { simulate, SIMS, type Draws } from './sim';
import { SALARY_CAP } from './value';

export const MAX_COMPARE = 3;

export interface PlayerOdds {
  id: string;
  pMost: number; // chance of scoring the most points of the group
  pMostPerK: number; // chance of the most points per $1,000 of salary
  pPace: number; // chance of reaching salary pace (salary x T / 50,000)
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface HeadToHead {
  a: string;
  b: string;
  pA: number; // chance a outscores b
}

export interface CompareResult {
  odds: PlayerOdds[];
  h2h: HeadToHead[];
}

function quantile(sorted: Float32Array, q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

export function compareOdds(players: Player[], targetTotal: number, draws: Draws = simulate(players)): CompareResult {
  const cols = players.map((p) => draws.get(p.id) ?? new Float32Array(SIMS));
  const n = cols[0]?.length ?? 0;
  const most = new Array<number>(players.length).fill(0);
  const mostK = new Array<number>(players.length).fill(0);
  const pace = new Array<number>(players.length).fill(0);
  const wins = players.map(() => new Array<number>(players.length).fill(0));
  for (let k = 0; k < n; k++) {
    let best = -Infinity;
    let bestK = -Infinity;
    let leaders: number[] = [];
    let leadersK: number[] = [];
    players.forEach((p, i) => {
      const x = cols[i][k];
      const perK = x / (p.salary / 1000);
      if (x > best) [best, leaders] = [x, [i]];
      else if (x === best) leaders.push(i);
      if (perK > bestK) [bestK, leadersK] = [perK, [i]];
      else if (perK === bestK) leadersK.push(i);
      if (x >= (p.salary * targetTotal) / SALARY_CAP) pace[i]++;
      players.forEach((_, j) => {
        if (j === i) return;
        const y = cols[j][k];
        wins[i][j] += x > y ? 1 : x === y ? 0.5 : 0;
      });
    });
    leaders.forEach((i) => (most[i] += 1 / leaders.length)); // ties split (e.g. two players on 0)
    leadersK.forEach((i) => (mostK[i] += 1 / leadersK.length));
  }
  const odds = players.map((p, i) => {
    const sorted = Float32Array.from(cols[i]).sort();
    return {
      id: p.id,
      pMost: n ? most[i] / n : 0,
      pMostPerK: n ? mostK[i] / n : 0,
      pPace: n ? pace[i] / n : 0,
      mean: n ? cols[i].reduce((s, x) => s + x, 0) / n : 0,
      p10: quantile(sorted, 0.1),
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
    };
  });
  const h2h: HeadToHead[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) h2h.push({ a: players[i].id, b: players[j].id, pA: n ? wins[i][j] / n : 0 });
  }
  return { odds, h2h };
}

export interface Verdict {
  pick: string | null; // id of the recommended player
  headline: string;
  reasons: string[];
  flags: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const last = (name: string) => name.replace(/ DST$/, ' defense');
const POS_WORD: Record<string, string> = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs' };

export function verdict(players: Player[], result: CompareResult): Verdict {
  if (players.length < 2) return { pick: null, headline: '', reasons: [], flags: [] };
  const byId = new Map(players.map((p) => [p.id, p]));
  const odds = [...result.odds].sort((a, b) => b.pMost - a.pMost);
  const [top, second] = odds;
  const P = (id: string) => byId.get(id)!;
  const close = top.pMost - second.pMost < 0.05;
  const headline = close
    ? `Coin flip: ${last(P(top.id).name)} ${pct(top.pMost)} vs ${last(P(second.id).name)} ${pct(second.pMost)} to score the most. Let salary, floor and matchup decide.`
    : `Pick ${last(P(top.id).name)}: scores the most in ${pct(top.pMost)} of ${SIMS.toLocaleString()} simulated games.`;

  const reasons: string[] = [];
  const maxBy = (f: (o: PlayerOdds) => number) => result.odds.reduce((a, b) => (f(b) > f(a) ? b : a));
  const safest = maxBy((o) => o.p10);
  const ceiling = maxBy((o) => o.p90);
  const value = maxBy((o) => o.pMostPerK);
  if (safest.id === top.id && ceiling.id === top.id) {
    reasons.push(`${last(P(top.id).name)} also has the highest floor (${safest.p10.toFixed(1)}) and ceiling (${ceiling.p90.toFixed(1)}).`);
  } else {
    reasons.push(`${safest.id === top.id ? 'Also the' : `${last(P(safest.id).name)} has the`} highest floor: 9 times in 10 at least ${safest.p10.toFixed(1)} points${safest.id === top.id ? '' : ' (the safer cash-game play)'}.`);
    if (ceiling.id !== top.id) reasons.push(`${last(P(ceiling.id).name)} has the biggest ceiling (${ceiling.p90.toFixed(1)} in his best 1 in 10 games): the tournament play.`);
  }
  if (value.id !== top.id) {
    const diff = P(top.id).salary - P(value.id).salary;
    reasons.push(`${last(P(value.id).name)} is the best value: most points per $1K in ${pct(value.pMostPerK)} of games${diff > 0 ? `, and $${diff.toLocaleString('en-US')} cheaper` : ''}. Better if you need the salary elsewhere.`);
  }

  const flags: string[] = [];
  for (const p of players) {
    if (p.status === 'Q') flags.push(`${last(p.name)} is Questionable: check the news before lock.`);
    if (p.status === 'D' || p.status === 'O' || p.status === 'IR') flags.push(`${last(p.name)} is listed ${p.status === 'D' ? 'Doubtful' : p.status === 'O' ? 'Out' : 'on IR'}.`);
    if (p.proj && p.proj_sd != null && p.n_sources >= 2 && p.proj_sd / p.proj > 0.15) {
      flags.push(`Sources disagree on ${last(p.name)} (${p.proj_min?.toFixed(1)}–${p.proj_max?.toFixed(1)} points).`);
    }
    const m = p.matchup;
    if (m && m.kind === 'defense' && m.games >= 2) {
      if (m.rank <= 5) flags.push(`${last(p.name)} faces one of the softest defenses for ${POS_WORD[p.pos]} (${p.opp} allows the ${ordinal(m.rank)}-most points).`);
      else if (m.rank > m.teams - 5) flags.push(`${last(p.name)} has a tough matchup (${p.opp} allows the ${ordinal(m.teams - m.rank + 1)}-fewest points to ${POS_WORD[p.pos]}).`);
    }
    const graded = (p.log ?? []).filter((g) => !g.dnp && g.proj != null).slice(0, 4);
    if (graded.length >= 3) {
      const beat = graded.filter((g) => g.actual > g.proj!).length;
      if (beat === graded.length || beat === 0) {
        flags.push(`${last(p.name)} has ${beat ? 'beaten' : 'fallen short of'} our projection in ${beat ? beat : graded.length} of his last ${graded.length} games.`);
      }
    }
  }
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const [a, b] = [players[i], players[j]];
      if (a.team === b.team && a.pos !== 'DST' && b.pos !== 'DST') {
        const qbPair = a.pos === 'QB' || b.pos === 'QB';
        flags.push(qbPair
          ? `${last(a.name)} and ${last(b.name)} are teammates with a QB: their good games tend to come together.`
          : `${last(a.name)} and ${last(b.name)} are teammates sharing the ball: one's big game often means a quieter one for the other.`);
      }
      const [dst, off] = a.pos === 'DST' ? [a, b] : b.pos === 'DST' ? [b, a] : [null, null];
      if (dst && off && off.pos !== 'DST' && dst.opp === off.team) {
        flags.push(`${last(dst.name)} faces ${last(off.name)}'s offense: a good game for one usually means a bad game for the other.`);
      }
    }
  }
  return { pick: close ? null : top.id, headline, reasons, flags };
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
