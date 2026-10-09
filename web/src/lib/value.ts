/**
 * Cash-game value model.
 *
 * Every component is a z-score *within the player's position*, computed over the value pool
 * (players with a projection above the position minimum who are not Doubtful/Out/IR),
 * clipped to ±3:
 *
 *   efficiency   = proj / (salary / 1000)                    points per $1K
 *   positional   = proj − (a_pos + b_pos · salary)           points above this slate's salary curve
 *   budget       = proj − salary · T / 50,000                points above the pace a T-point lineup needs
 *   reliability  = 0.3·z(−source CV) + 0.7·z(floor / proj) − Q penalty
 *                  (floor/proj, i.e. historical volatility, predicted busts far better than source
 *                  disagreement in the 2026 backtest, so it carries more weight)
 *
 *   value = Σ wᵢ · componentᵢ / Σ wᵢ
 *
 * "positional" fixes raw points-per-dollar's bias toward min-priced players: it compares a
 * player to what this slate's pricing says someone at his salary should score.
 * "budget" is an absolute surplus rather than a ratio. The ratio form, (proj/T)/(salary/cap),
 * is just efficiency × cap/T, so it would double-count efficiency. The surplus rewards players
 * who add points in large chunks, which matters because a lineup only has nine slots.
 */
import type { Player, Pos } from '../types';

export interface Weights {
  efficiency: number;
  positional: number;
  budget: number;
  reliability: number;
}

export interface ValueSettings {
  weights: Weights;
  targetTotal: number; // T: projected total of a typical winning cash lineup
  qPenalty: number; // subtracted from reliability for Questionable players
  excludeQuestionable: boolean;
}

export const PRESETS: Record<string, Weights> = {
  'Cash default': { efficiency: 0.25, positional: 0.3, budget: 0.2, reliability: 0.25 },
  'Pure efficiency': { efficiency: 1, positional: 0, budget: 0, reliability: 0 },
  'Safe floor': { efficiency: 0.15, positional: 0.25, budget: 0.15, reliability: 0.45 },
  'Points surplus': { efficiency: 0.1, positional: 0.3, budget: 0.45, reliability: 0.15 },
};

export const DEFAULT_SETTINGS: ValueSettings = {
  weights: PRESETS['Cash default'],
  targetTotal: 150,
  qPenalty: 0.5,
  excludeQuestionable: false,
};

export const SALARY_CAP = 50000;
/** Share of Reliability from source agreement; the rest is the floor ratio. */
export const AGREEMENT_SHARE = 0.3;
const CLIP = 3;

export interface Components {
  efficiency: number; // raw pts / $1K
  positional: number; // raw points above salary curve
  budget: number; // raw points surplus
  sourceCv: number | null; // proj_sd / proj
  consistency: number | null; // floor / proj
  z: { efficiency: number; positional: number; budget: number; agreement: number; consistency: number };
  reliability: number;
}

export interface ValuedPlayer extends Player {
  inValuePool: boolean;
  poolReason: string | null; // why a player is outside the pool
  components: Components | null;
  value: number | null;
  posRank: number | null;
}

interface Fit {
  a: number;
  b: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function zScorer(xs: number[]): (x: number) => number {
  const m = mean(xs);
  const s = sd(xs);
  return (x) => (s > 0 ? Math.max(-CLIP, Math.min(CLIP, (x - m) / s)) : 0);
}

/** Ordinary least squares proj ~ a + b·salary. */
export function fitSalaryCurve(points: { salary: number; proj: number }[]): Fit {
  if (points.length < 3) return { a: mean(points.map((p) => p.proj)), b: 0 };
  const mx = mean(points.map((p) => p.salary));
  const my = mean(points.map((p) => p.proj));
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.salary - mx) * (p.proj - my);
    sxx += (p.salary - mx) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

export function poolReason(p: Player, settings: ValueSettings): string | null {
  if (p.proj == null) return 'no projection';
  if (p.status === 'D' || p.status === 'O' || p.status === 'IR') return `status ${p.status}`;
  if (settings.excludeQuestionable && p.status === 'Q') return 'questionable (excluded)';
  if (!p.in_pool) return 'below projection minimum';
  return null;
}

export function computeValues(players: Player[], settings: ValueSettings = DEFAULT_SETTINGS): ValuedPlayer[] {
  const T = settings.targetTotal;
  const w = settings.weights;
  const wsum = w.efficiency + w.positional + w.budget + w.reliability || 1;
  const out: ValuedPlayer[] = [];
  const positions = [...new Set(players.map((p) => p.pos))] as Pos[];

  for (const pos of positions) {
    const group = players.filter((p) => p.pos === pos);
    const pool = group.filter((p) => poolReason(p, settings) == null) as (Player & { proj: number })[];
    const fit = fitSalaryCurve(pool);
    const raw = (p: Player & { proj: number }) => ({
      efficiency: p.proj / (p.salary / 1000),
      positional: p.proj - (fit.a + fit.b * p.salary),
      budget: p.proj - (p.salary * T) / SALARY_CAP,
      sourceCv: p.n_sources >= 2 && p.proj_sd != null && p.proj > 0 ? p.proj_sd / p.proj : null,
      consistency: p.floor != null && p.proj > 0 ? p.floor / p.proj : null,
    });
    const poolRaw = pool.map(raw);
    // Single-source players get the position's worst-decile disagreement.
    const knownCv = poolRaw.map((r) => r.sourceCv).filter((x): x is number => x != null);
    const missingCv = quantile(knownCv, 0.9);
    const zEff = zScorer(poolRaw.map((r) => r.efficiency));
    const zPos = zScorer(poolRaw.map((r) => r.positional));
    const zBud = zScorer(poolRaw.map((r) => r.budget));
    const zAgree = zScorer(poolRaw.map((r) => -(r.sourceCv ?? missingCv)));
    const cons = poolRaw.map((r) => r.consistency ?? 0);
    const zCons = zScorer(cons);

    const valued: ValuedPlayer[] = group.map((p) => {
      const reason = poolReason(p, settings);
      if (p.proj == null) {
        return { ...p, inValuePool: false, poolReason: reason, components: null, value: null, posRank: null };
      }
      const r = raw(p as Player & { proj: number });
      const z = {
        efficiency: zEff(r.efficiency),
        positional: zPos(r.positional),
        budget: zBud(r.budget),
        agreement: zAgree(-(r.sourceCv ?? missingCv)),
        consistency: zCons(r.consistency ?? 0),
      };
      const reliability = AGREEMENT_SHARE * z.agreement + (1 - AGREEMENT_SHARE) * z.consistency - (p.status === 'Q' ? settings.qPenalty : 0);
      const value =
        (w.efficiency * z.efficiency + w.positional * z.positional + w.budget * z.budget + w.reliability * reliability) / wsum;
      return {
        ...p,
        inValuePool: reason == null,
        poolReason: reason,
        components: { ...r, z, reliability },
        value: round(value, 3),
        posRank: null,
      };
    });
    valued
      .filter((p) => p.inValuePool)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .forEach((p, i) => (p.posRank = i + 1));
    out.push(...valued);
  }
  return out;
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
