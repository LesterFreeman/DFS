/**
 * Player context pieces shared by the Compare tab and the player panel: the game-log chart and
 * table, and plain-English wording for the spread and the matchup.
 */
import { ordinal } from '../lib/compare';
import { fixed, signed } from '../lib/format';
import type { ValuedPlayer } from '../lib/value';
import type { Game, GameLogEntry, Player } from '../types';

/** "favored by 7" / "underdog by 3" / "pick’em" for a team in a game (nflverse: + = home favored). */
export function spreadText(g: Game | undefined, team: string): string {
  if (!g || g.spread == null) return '–';
  const fav = g.spread > 0 ? g.home : g.spread < 0 ? g.away : null;
  if (!fav) return 'pick’em';
  return fav === team ? `favored by ${Math.abs(g.spread)}` : `underdog by ${Math.abs(g.spread)}`;
}

/** How easy this week's opponent is for the player's position. Null without matchup data. */
export function matchupText(p: Player): { main: string; sub: string; ease: 'easy' | 'average' | 'tough' } | null {
  const m = p.matchup;
  if (!m) return null;
  const ease = m.rank <= Math.ceil(m.teams / 4) ? 'easy' : m.rank > m.teams - Math.ceil(m.teams / 4) ? 'tough' : 'average';
  const main = m.kind === 'offense' ? `${p.opp} scores ${m.allowed}/gm` : `${p.opp} allows ${m.allowed}/gm to ${p.pos}s`;
  return { main, sub: `${m.rank === 1 ? 'easiest' : `${ordinal(m.rank)}-easiest`} matchup of ${m.teams} (${ease}) · league avg ${m.pos_avg}`, ease };
}

export function ChartLegend() {
  return (
    <span className="gl-legend">
      <span><i className="sw-bar" />Actual</span>
      <span><i className="sw-line" />Our projection</span>
    </span>
  );
}

/** Recent games: a column per game for actual points, a tick for our pre-kickoff projection. */
export function GameLogChart({ log, name }: { log: GameLogEntry[]; name: string }) {
  const games = [...log].slice(0, 6).reverse(); // oldest on the left
  if (!games.length) return <span className="muted small">No games yet this season</span>;
  const top = Math.max(10, ...games.map((g) => Math.max(g.actual, g.proj ?? 0)));
  const yMax = Math.ceil(top / 10) * 10;
  const slot = 30;
  const W = games.length * slot + 26;
  const H = 96;
  const base = 78;
  const y = (v: number) => base - (v / yMax) * (base - 8);
  return (
    <figure className="glchart">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`${name}: last ${games.length} games, actual vs projected points`}>
        <line x1={24} x2={W} y1={y(yMax)} y2={y(yMax)} className="grid" />
        <line x1={24} x2={W} y1={base} y2={base} className="grid" />
        <text x={20} y={y(yMax) + 3} className="tick" textAnchor="end">{yMax}</text>
        <text x={20} y={base + 3} className="tick" textAnchor="end">0</text>
        {games.map((g, i) => {
          const cx = 26 + i * slot + slot / 2;
          const top = y(g.actual);
          const h = base - top;
          const r = Math.min(4, h);
          const bw = 14;
          const path = h > 0.5
            ? `M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z`
            : '';
          const tip = `Week ${g.week}${g.opp ? ` vs ${g.opp}` : ''}: ${g.dnp ? 'did not play' : `${g.actual.toFixed(1)} pts`}${g.proj != null ? ` · projected ${g.proj.toFixed(1)}` : ''}`;
          return (
            <g key={g.week} className="glgame">
              <title>{tip}</title>
              <rect x={cx - slot / 2} y={0} width={slot} height={H} className="hit" />
              {path && <path d={path} className="bar" />}
              {g.dnp && <text x={cx} y={base - 4} className="tick" textAnchor="middle">–</text>}
              {g.proj != null && <line x1={cx - 10} x2={cx + 10} y1={y(g.proj)} y2={y(g.proj)} className="projtick" />}
              <text x={cx} y={H - 4} className="tick" textAnchor="middle">W{g.week}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function GameLogTable({ p }: { p: ValuedPlayer }) {
  const log = p.log ?? [];
  if (!log.length) return <p className="muted small">No games yet this season.</p>;
  const line = (g: GameLogEntry) => {
    const l = g.line;
    if (g.dnp) return 'did not play';
    const parts: string[] = [];
    if (l.pass_yd) parts.push(`${l.pass_yd} pass yds, ${l.pass_td ?? 0} TD${l.int ? `, ${l.int} INT` : ''}`);
    if (l.car) parts.push(`${l.car} car, ${l.rush_yd ?? 0} yds${l.rush_td ? `, ${l.rush_td} TD` : ''}`);
    if (l.tgt || l.rec) parts.push(`${l.rec ?? 0}/${l.tgt ?? 0} rec, ${l.rec_yd ?? 0} yds${l.rec_td ? `, ${l.rec_td} TD` : ''}`);
    return parts.join(' · ') || '–';
  };
  return (
    <table className="mini gltable">
      <thead>
        <tr>
          <th>Wk</th>
          <th>Opp</th>
          <th className="num">Proj</th>
          <th className="num">Actual</th>
          <th>Stat line</th>
        </tr>
      </thead>
      <tbody>
        {log.map((g) => (
          <tr key={g.week}>
            <td>{g.week}</td>
            <td>{g.opp ?? ''}</td>
            <td className="num muted">{fixed(g.proj)}</td>
            <td className="num">
              <b>{fixed(g.actual)}</b>
              {g.proj != null && !g.dnp && <span className={g.actual >= g.proj ? 'up' : 'down'}> {signed(g.actual - g.proj, 1)}</span>}
            </td>
            <td className="small">{line(g)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

