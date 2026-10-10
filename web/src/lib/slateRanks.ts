/**
 * Where each team and game sits on this week's slate, for context next to Vegas numbers:
 * "27.5 team total, 2nd of 26 teams". Built from slate.json (implied totals, totals, spreads).
 * Teams without lines are left out, so ranks read "of N teams with lines".
 */
import type { Slate } from '../types';

export interface TeamRank {
  team: string;
  opp: string;
  game: string;
  implied: number; // team implied total
  impliedRank: number; // 1 = highest on the slate
  oppImplied: number;
  oppImpliedRank: number; // 1 = lowest opponent total (best for a DST)
  margin: number; // + = favored by, − = underdog by
  favoriteRank: number | null; // 1 = biggest favorite on the slate; null if not favored
  share: number | null; // team implied / game total
}

export interface GameRank {
  game: string;
  total: number;
  totalRank: number; // 1 = highest on the slate
}

export interface SlateRanks {
  teams: Map<string, TeamRank>;
  games: Map<string, GameRank>;
  teamCount: number;
  gameCount: number;
  favorites: number;
  avgImplied: number;
  avgTotal: number;
}

export function slateRanks(slate: Slate): SlateRanks {
  const rows: Omit<TeamRank, 'impliedRank' | 'oppImpliedRank' | 'favoriteRank'>[] = [];
  const games: Omit<GameRank, 'totalRank'>[] = [];
  for (const g of slate.games) {
    const imp = g.implied;
    if (g.total != null) games.push({ game: g.game, total: g.total });
    if (!imp || imp[g.home] == null || imp[g.away] == null) continue;
    // nflverse convention: positive spread = home team favored
    const homeMargin = g.spread ?? imp[g.home] - imp[g.away];
    for (const [team, opp, margin] of [[g.home, g.away, homeMargin], [g.away, g.home, -homeMargin]] as const) {
      rows.push({
        team, opp, game: g.game, implied: imp[team], oppImplied: imp[opp], margin,
        share: g.total ? imp[team] / g.total : null,
      });
    }
  }
  const rankBy = <T,>(xs: T[], key: (x: T) => number) => {
    const sorted = [...xs].sort((a, b) => key(b) - key(a));
    return (x: T) => 1 + sorted.findIndex((y) => key(y) === key(x)); // ties share the better rank
  };
  const byImplied = rankBy(rows, (r) => r.implied);
  const byOpp = rankBy(rows, (r) => -r.oppImplied);
  const favs = rows.filter((r) => r.margin > 0);
  const byFav = rankBy(favs, (r) => r.margin);
  const byTotal = rankBy(games, (g) => g.total);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    teams: new Map(rows.map((r) => [r.team, {
      ...r, impliedRank: byImplied(r), oppImpliedRank: byOpp(r), favoriteRank: r.margin > 0 ? byFav(r) : null,
    }])),
    games: new Map(games.map((g) => [g.game, { ...g, totalRank: byTotal(g) }])),
    teamCount: rows.length,
    gameCount: games.length,
    favorites: favs.length,
    avgImplied: mean(rows.map((r) => r.implied)),
    avgTotal: mean(games.map((g) => g.total)),
  };
}
