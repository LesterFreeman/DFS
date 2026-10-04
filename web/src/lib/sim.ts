/**
 * Correlated Monte Carlo of a slate, so lineups can be judged as a whole rather than as a sum of
 * independent players.
 *
 * Each player's score is lognormal with mean = proj and sd = sigma (right-skewed, like real
 * fantasy scores: a bad week can't go far below zero, a touchdown week can double the projection).
 * Players are linked through shared standard-normal factors (a Gaussian copula):
 *
 *   G  game environment (pace, scoring)    every offensive player in the game; DSTs negatively
 *   P  team passing game                   QB, WR, TE
 *   R  team running game                   RB
 *   S  team game script (leading)          RB, own DST
 *   opposing P, R                          a DST suffers when the offense it faces does well
 *
 * Loadings give roughly: QB-WR 0.38, QB-TE 0.32, WR-WR (same team) 0.29, QB-opposing WR 0.09,
 * RB-own DST 0.12, DST-opposing QB -0.33. These are sensible defaults from DFS research, not
 * fitted to our data yet (the backtest will tell us whether they need tuning).
 */
import type { Player } from '../types';

export const SIMS = 2000;

type Loading = { G: number; P: number; R: number; S: number; oppP: number; oppR: number };
const L: Record<string, Loading> = {
  QB: { G: 0.3, P: 0.65, R: 0, S: 0, oppP: 0, oppR: 0 },
  RB: { G: 0.3, P: 0, R: 0.55, S: 0.3, oppP: 0, oppR: 0 },
  WR: { G: 0.3, P: 0.45, R: 0, S: 0, oppP: 0, oppR: 0 },
  TE: { G: 0.3, P: 0.35, R: 0, S: 0, oppP: 0, oppR: 0 },
  DST: { G: -0.25, P: 0, R: 0, S: 0.4, oppP: -0.4, oppR: -0.2 },
};

/** Small, fast, seedable PRNG (mulberry32), so the same slate always gives the same lineups. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normals(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare != null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

export type Draws = Map<string, Float32Array>;

/** n simulated scores per player id. */
export function simulate(players: Player[], n = SIMS, seed = 7): Draws {
  const norm = normals(rng(seed));
  const games = [...new Set(players.map((p) => p.game ?? `solo-${p.team}`))];
  const teams = [...new Set(players.flatMap((p) => [p.team, p.opp ?? '']).filter(Boolean))];
  const gi = new Map(games.map((g, i) => [g, i]));
  const ti = new Map(teams.map((t, i) => [t, i]));
  const G = new Float64Array(games.length);
  const P = new Float64Array(teams.length);
  const R = new Float64Array(teams.length);
  const S = new Float64Array(teams.length);
  const specs = players.map((p) => {
    const m = Math.max(0, p.proj ?? 0);
    const s = Math.max(0.5, p.sigma ?? m * 0.6);
    const sl = m > 0.1 ? Math.sqrt(Math.log(1 + (s * s) / (m * m))) : 0;
    const l = L[p.pos] ?? L.WR;
    const shared = l.G ** 2 + l.P ** 2 + l.R ** 2 + l.S ** 2 + l.oppP ** 2 + l.oppR ** 2;
    return {
      m, sl, mu: m > 0.1 ? Math.log(m) - (sl * sl) / 2 : 0, l, idio: Math.sqrt(Math.max(0, 1 - shared)),
      g: gi.get(p.game ?? `solo-${p.team}`)!, t: ti.get(p.team)!, o: p.opp ? ti.get(p.opp) : undefined,
    };
  });
  const out: Draws = new Map(players.map((p) => [p.id, new Float32Array(n)]));
  const arrays = players.map((p) => out.get(p.id)!);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < G.length; i++) G[i] = norm();
    for (let i = 0; i < P.length; i++) {
      P[i] = norm();
      R[i] = norm();
      S[i] = norm();
    }
    specs.forEach((sp, j) => {
      if (sp.m <= 0.1) return; // stays 0
      const { l } = sp;
      let z = l.G * G[sp.g] + l.P * P[sp.t] + l.R * R[sp.t] + l.S * S[sp.t] + sp.idio * norm();
      if (sp.o != null) z += l.oppP * P[sp.o] + l.oppR * R[sp.o];
      arrays[j][k] = Math.exp(sp.mu + sp.sl * z);
    });
  }
  return out;
}

export interface LineupStats {
  mean: number;
  p10: number; // lineup floor: 1 in 10 slates score below this
  p50: number;
  p90: number; // lineup ceiling
  pTarget: number; // chance of reaching the target score
}

export function lineupStats(ids: string[], draws: Draws, target: number): LineupStats {
  const cols = ids.map((id) => draws.get(id)).filter((d): d is Float32Array => d != null);
  const n = cols[0]?.length ?? 0;
  const totals = new Float64Array(n);
  for (const c of cols) for (let k = 0; k < n; k++) totals[k] += c[k];
  let hit = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    sum += totals[k];
    if (totals[k] >= target) hit++;
  }
  totals.sort();
  const q = (x: number) => (n ? totals[Math.min(n - 1, Math.floor(x * n))] : 0);
  return { mean: n ? sum / n : 0, p10: q(0.1), p50: q(0.5), p90: q(0.9), pTarget: n ? hit / n : 0 };
}

/** Correlation of two players' simulated scores (used by tests and for sanity checks). */
export function correlation(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < n; k++) {
    ma += a[k];
    mb += b[k];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let k = 0; k < n; k++) {
    sab += (a[k] - ma) * (b[k] - mb);
    saa += (a[k] - ma) ** 2;
    sbb += (b[k] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
