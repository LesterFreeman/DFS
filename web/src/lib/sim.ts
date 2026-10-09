/**
 * Correlated Monte Carlo of a slate, so lineups can be judged as a whole rather than as a sum of
 * independent players. Calibrated on the 2026 backtest (weeks 1-4, 867 player-games).
 *
 * Player outcome (mean = proj in every case):
 *   - with probability BUST[pos] a "bust" game (in-game injury, benching, zero targets):
 *     uniform between 0 and half the projection;
 *   - otherwise lognormal (right-skewed), with sd = sigma x SPREAD[pos]. DSTs use a lognormal
 *     shifted by 4 points so they can score 0 or go negative.
 *   Before calibration the lognormal alone put 20-22% of RB/WR/TE/DST games below its own 10th
 *   percentile (real busts are common); this model puts 11-13% there.
 *
 * Players in the same game are linked by an explicit correlation table (Gaussian copula). The
 * backtest showed teammates compete for the same touches: a QB and his receivers rise together
 * (+0.25), but receivers on one team move slightly against each other, as do two backs, and the
 * two offenses in a game barely move together. A DST suffers when the offense it faces does well.
 */
import type { Player, Pos } from '../types';

export const SIMS = 2000;

/** Chance of a bust game, by position. */
export const BUST: Record<Pos, number> = { QB: 0.03, RB: 0.1, WR: 0.1, TE: 0.08, DST: 0 };
/** Multiplier on the pipeline's sigma, by position. */
export const SPREAD: Record<Pos, number> = { QB: 1.05, RB: 1.15, WR: 1.15, TE: 1.2, DST: 1.1 };
const DST_SHIFT = 4;

type Pair = `${Pos}-${Pos}`;
/** Correlation of two teammates' scores (measured on the backtest, shrunk toward 0 where samples are small). */
export const SAME_TEAM: Partial<Record<Pair, number>> = {
  'QB-WR': 0.25, 'QB-TE': 0.2, 'QB-RB': 0.05,
  'WR-WR': -0.1, 'WR-TE': -0.06, 'TE-TE': 0,
  'RB-RB': -0.08, 'RB-WR': 0, 'RB-TE': -0.08,
  'DST-RB': 0.05, 'DST-QB': 0, 'DST-WR': -0.03, 'DST-TE': -0.03,
};
/** Correlation of two opponents' scores. */
export const OPPONENTS: Partial<Record<Pair, number>> = {
  'QB-QB': 0.03, 'QB-WR': 0.02, 'QB-TE': 0, 'QB-RB': 0.03, 'WR-WR': 0.02,
  'DST-QB': -0.35, 'DST-RB': -0.15, 'DST-WR': -0.12, 'DST-TE': -0.08,
};

const ORDER: Pos[] = ['QB', 'RB', 'WR', 'TE', 'DST'];
const key = (a: Pos, b: Pos): Pair => {
  const [x, y] = ORDER.indexOf(a) <= ORDER.indexOf(b) ? [a, b] : [b, a];
  // tables list DST first for DST pairs
  return (y === 'DST' ? `DST-${x}` : `${x}-${y}`) as Pair;
};

export function pairCorrelation(a: Player, b: Player): number {
  if (a.team === b.team) return SAME_TEAM[key(a.pos, b.pos)] ?? 0;
  if (a.opp === b.team) return OPPONENTS[key(a.pos, b.pos)] ?? 0;
  return 0;
}

/** Lower-triangular Cholesky factor; shrinks the off-diagonals until the matrix is valid. */
export function cholesky(r: number[][]): number[][] {
  const n = r.length;
  for (let shrink = 1; shrink > 0.05; shrink *= 0.9) {
    const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = i === j ? 1 : r[i][j] * shrink;
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (sum <= 1e-9) {
            ok = false;
            break;
          }
          L[i][i] = Math.sqrt(sum);
        } else {
          L[i][j] = sum / L[j][j];
        }
      }
    }
    if (ok) return L;
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

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

interface Spec {
  m: number; // projection
  q: number; // bust probability
  shift: number;
  mu: number;
  sl: number;
}

function spec(p: Player): Spec {
  const m = Math.max(0, p.proj ?? 0);
  const q = BUST[p.pos] ?? 0;
  const shift = p.pos === 'DST' ? DST_SHIFT : 0;
  // the non-bust part carries the rest of the mean; a bust averages a quarter of the projection
  const mn = (m - q * 0.25 * m) / (1 - q) + shift;
  const s = Math.max(0.5, (p.sigma ?? m * 0.6) * (SPREAD[p.pos] ?? 1)) * (m > 0 ? (mn - shift) / m : 1);
  const sl = mn > 0.1 ? Math.sqrt(Math.log(1 + (s * s) / (mn * mn))) : 0;
  return { m, q, shift, sl, mu: mn > 0.1 ? Math.log(mn) - (sl * sl) / 2 : 0 };
}

/** n simulated scores per player id. */
export function simulate(players: Player[], n = SIMS, seed = 7): Draws {
  const rand = rng(seed);
  const norm = normals(rand);
  const out: Draws = new Map(players.map((p) => [p.id, new Float32Array(n)]));
  const groups = new Map<string, Player[]>();
  for (const p of players) {
    const g = p.game ?? `solo-${p.team}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const blocks = [...groups.values()].map((ps) => ({
    ps,
    specs: ps.map(spec),
    L: cholesky(ps.map((a) => ps.map((b) => (a === b ? 1 : pairCorrelation(a, b))))),
    cols: ps.map((p) => out.get(p.id)!),
  }));
  const maxN = Math.max(0, ...blocks.map((b) => b.ps.length));
  const e = new Float64Array(maxN);
  for (let k = 0; k < n; k++) {
    for (const { ps, specs, L, cols } of blocks) {
      for (let i = 0; i < ps.length; i++) e[i] = norm();
      for (let i = 0; i < ps.length; i++) {
        const sp = specs[i];
        if (sp.m <= 0.1) continue; // stays 0
        if (sp.q > 0 && rand() < sp.q) {
          cols[i][k] = rand() * 0.5 * sp.m;
          continue;
        }
        let z = 0;
        const row = L[i];
        for (let j = 0; j <= i; j++) z += row[j] * e[j];
        cols[i][k] = Math.exp(sp.mu + sp.sl * z) - sp.shift;
      }
    }
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
