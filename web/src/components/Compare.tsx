import { useMemo, useState, type ReactNode } from 'react';
import { compareOdds, MAX_COMPARE, ordinal, verdict } from '../lib/compare';
import { fixed, kickoff, money, signed } from '../lib/format';
import type { ValuedPlayer, ValueSettings } from '../lib/value';
import type { GameLogEntry, Slate } from '../types';
import { StatusPill } from './PlayerTable';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Index of the best value in a row (null when all equal or missing). */
function best(values: (number | null | undefined)[], dir: 'max' | 'min' = 'max'): number | null {
  const xs = values.map((v) => (v == null || Number.isNaN(v) ? null : v));
  const present = xs.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const target = dir === 'max' ? Math.max(...present) : Math.min(...present);
  if (present.every((v) => v === target)) return null;
  return xs.indexOf(target);
}

/** Recent games: a column per game for actual points, a tick for our pre-kickoff projection. */
function GameLogChart({ log, name }: { log: GameLogEntry[]; name: string }) {
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

function GameLogTable({ p }: { p: ValuedPlayer }) {
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

export function Compare({ players, slate, settings, ids, onIds, onSelect }: {
  players: ValuedPlayer[];
  slate: Slate;
  settings: ValueSettings;
  ids: string[];
  onIds: (ids: string[]) => void;
  onSelect: (p: ValuedPlayer) => void;
}) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const chosen = ids.map((id) => byId.get(id)).filter((p): p is ValuedPlayer => p != null && p.proj != null);
  const needle = q.trim().toLowerCase();
  const suggestions = needle
    ? players
        .filter((p) => p.proj != null && !ids.includes(p.id))
        .filter((p) => `${p.name} ${p.team} ${p.pos}`.toLowerCase().includes(needle))
        .sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0))
        .slice(0, 8)
    : [];
  const result = useMemo(() => (chosen.length >= 1 ? compareOdds(chosen, settings.targetTotal) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen.map((p) => p.id).join(), settings.targetTotal]);
  const v = result && chosen.length >= 2 ? verdict(chosen, result) : null;
  const odds = (id: string) => result?.odds.find((o) => o.id === id);
  const game = (p: ValuedPlayer) => slate.games.find((g) => g.game === p.game);
  const add = (id: string) => {
    if (ids.length < MAX_COMPARE && !ids.includes(id)) onIds([...ids, id]);
    setQ('');
  };

  const row = (label: ReactNode, title: string, cells: (p: ValuedPlayer, i: number) => ReactNode,
    values?: (number | null | undefined)[], dir: 'max' | 'min' = 'max') => {
    const b = values ? best(values, dir) : null;
    return (
      <tr>
        <th scope="row" title={title}>{label}</th>
        {chosen.map((p, i) => (
          <td key={p.id} className={b === i ? 'best' : ''}>{cells(p, i)}</td>
        ))}
      </tr>
    );
  };

  const spreadText = (p: ValuedPlayer) => {
    const g = game(p);
    if (!g || g.spread == null) return '–';
    // nflverse: positive spread = home team favored
    const fav = g.spread > 0 ? g.home : g.spread < 0 ? g.away : null;
    if (!fav) return 'pick’em';
    return fav === p.team ? `favored by ${Math.abs(g.spread)}` : `underdog by ${Math.abs(g.spread)}`;
  };
  const hasContext = chosen.some((p) => p.log !== undefined);

  return (
    <section className="compare">
      <p className="muted">Pick up to {MAX_COMPARE} players (any position) to see who is most likely to score the most this week, and why.</p>
      <div className="compare-picker">
        {chosen.map((p) => (
          <button key={p.id} className="tag on" onClick={() => onIds(ids.filter((x) => x !== p.id))} title="Remove">
            {p.name} · {p.pos} {p.team} ×
          </button>
        ))}
        {ids.length < MAX_COMPARE && (
          <div className="picker-box">
            <input type="search" className="search" placeholder={chosen.length ? 'Add another player…' : 'Search a player (name, team or position)'}
              value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players to compare"
              onKeyDown={(e) => e.key === 'Enter' && suggestions[0] && add(suggestions[0].id)} />
            {suggestions.length > 0 && (
              <ul className="suggest" role="listbox">
                {suggestions.map((p) => (
                  <li key={p.id} role="option" aria-selected={false} onClick={() => add(p.id)}>
                    <b>{p.name}</b> <span className="muted">{p.pos} · {p.team} {p.home ? 'vs' : '@'} {p.opp} · {money(p.salary)} · {fixed(p.proj)} proj</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {chosen.length > 0 && <button className="link" onClick={() => onIds([])}>Clear</button>}
      </div>

      {chosen.length === 0 && <p className="muted small">Tip: open any player from the Players tab and press “Compare”.</p>}
      {chosen.length === 1 && <p className="muted small">Add one or two more players to compare.</p>}

      {v && (
        <div className={`verdict ${v.pick ? '' : 'close'}`}>
          <p className="verdict-head">{v.headline}</p>
          <ul>
            {v.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          {v.flags.length > 0 && (
            <ul className="flags">
              {v.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      )}

      {chosen.length > 0 && result && (
        <div className="scroll-x">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {chosen.map((p) => (
                  <th key={p.id} scope="col">
                    <button className="link pname-link" onClick={() => onSelect(p)}>{p.name}</button>{' '}
                    <StatusPill status={p.status} conflict={p.status_conflict} />
                    <span className="psub">{p.pos} · {p.team} {p.home ? 'vs' : '@'} {p.opp} · {kickoff(p.kickoff, slate.timezone)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="section"><th colSpan={chosen.length + 1}>This week</th></tr>
              {chosen.length >= 2 && row('Chance to score the most', 'Share of 2,000 simulated games in which this player scores the most of the group',
                (p) => {
                  const o = odds(p.id)!;
                  return (
                    <span className="meter-cell">
                      <b>{pct(o.pMost)}</b>
                      <span className="meter"><span style={{ width: pct(o.pMost) }} /></span>
                    </span>
                  );
                }, chosen.map((p) => odds(p.id)?.pMost))}
              {row('Projection', 'Consensus of the projection sources (range across sources)',
                (p) => <>{fixed(p.proj)}{p.n_sources >= 2 && <span className="psub">{fixed(p.proj_min)}–{fixed(p.proj_max)} · {p.n_sources} sources</span>}</>,
                chosen.map((p) => p.proj))}
              {row('Floor (10th pct)', '9 times in 10 he scores at least this (simulated)', (p) => fixed(odds(p.id)?.p10), chosen.map((p) => odds(p.id)?.p10))}
              {row('Median', 'The middle outcome (simulated)', (p) => fixed(odds(p.id)?.p50), chosen.map((p) => odds(p.id)?.p50))}
              {row('Ceiling (90th pct)', 'His best 1 in 10 games (simulated)', (p) => fixed(odds(p.id)?.p90), chosen.map((p) => odds(p.id)?.p90))}
              {row('Salary', 'DraftKings salary', (p) => money(p.salary), chosen.map((p) => p.salary), 'min')}
              {row('Points per $1K', 'Projected points per $1,000 of salary', (p) => fixed((p.proj ?? 0) / (p.salary / 1000), 2),
                chosen.map((p) => (p.proj ?? 0) / (p.salary / 1000)))}
              {chosen.length >= 2 && row('Most points per $1K', 'Chance of the most points per dollar of the group (simulated)',
                (p) => pct(odds(p.id)!.pMostPerK), chosen.map((p) => odds(p.id)?.pMostPerK))}
              {row(`Reaches salary pace`, `Chance of at least salary × ${settings.targetTotal}/50,000 points (your target total T)`,
                (p) => <>{pct(odds(p.id)!.pPace)}<span className="psub">needs {fixed((p.salary * settings.targetTotal) / 50000)}</span></>,
                chosen.map((p) => odds(p.id)?.pPace))}
              {row('Value', 'The site’s value score within position (0 = average)', (p) => <>{signed(p.value)}{p.posRank ? <span className="psub">{p.pos}{p.posRank}</span> : null}</>,
                chosen.map((p) => p.value))}
              {row('From touchdowns', 'Share of the projection expected from touchdowns: higher = more boom-or-bust',
                (p) => (p.td_pts != null && p.proj ? pct(p.td_pts / p.proj) : '–'))}

              <tr className="section"><th colSpan={chosen.length + 1}>Vegas</th></tr>
              {row('Team total', 'Points sportsbooks expect his team to score', (p) => fixed(p.team_total), chosen.map((p) => p.team_total))}
              {row('Opponent total', 'Points sportsbooks expect the opponent to score', (p) => fixed(p.opp_total),
                chosen.map((p) => (p.pos === 'DST' ? p.opp_total : null)), 'min')}
              {row('Spread', 'Betting spread for his team', (p) => spreadText(p))}
              {row('Game total', 'Combined points expected in the game (over/under)', (p) => fixed(game(p)?.total), chosen.map((p) => game(p)?.total))}

              <tr className="section"><th colSpan={chosen.length + 1}>Matchup</th></tr>
              {row('Opponent', 'Who he plays this week', (p) => `${p.home ? 'vs' : '@'} ${p.opp ?? '–'}`)}
              {row('Opponent vs position', 'DK points the opponent gives up per game to this position this season (DSTs: points the opponent scores). Rank 1 = best matchup.',
                (p) => {
                  const m = p.matchup;
                  if (!m) return <span className="muted">{hasContext ? '–' : 'after next data refresh'}</span>;
                  const label = m.kind === 'offense'
                    ? `${p.opp} scores ${m.allowed}/gm`
                    : `${p.opp} allows ${m.allowed}/gm to ${p.pos}s`;
                  const ease = m.rank <= Math.ceil(m.teams / 4) ? 'easy' : m.rank > m.teams - Math.ceil(m.teams / 4) ? 'tough' : 'average';
                  return <>{label}<span className="psub">matchup {ordinal(m.rank)} easiest of {m.teams} ({ease}) · avg {m.pos_avg}</span></>;
                }, chosen.map((p) => (p.matchup ? -p.matchup.rank / p.matchup.teams : null)))}

              <tr className="section"><th colSpan={chosen.length + 1}>This season</th></tr>
              {row(<>Recent games<span className="gl-legend"><span><i className="sw-bar" />Actual</span><span><i className="sw-line" />Our projection</span></span></>,
                'Columns: actual DK points. Line: our projection before kickoff. Hover a game for details.',
                (p) => (p.pos === 'DST' ? <span className="muted small">Not tracked for defenses</span>
                  : p.log ? <GameLogChart log={p.log} name={p.name} /> : <span className="muted">after next data refresh</span>))}
              {row('Average DK points', 'Average over games played this season', (p) => (p.season_stats ? <>{fixed(p.season_stats.avg)}<span className="psub">{p.season_stats.games} games</span></> : '–'),
                chosen.map((p) => p.season_stats?.avg))}
              {row('vs our projection', 'Average of actual minus our pre-kickoff projection over his recent games',
                (p) => {
                  const g = (p.log ?? []).filter((x) => !x.dnp && x.proj != null);
                  if (!g.length) return '–';
                  const d = g.reduce((s, x) => s + x.actual - x.proj!, 0) / g.length;
                  return <>{signed(d, 1)}<span className="psub">over {g.length} games</span></>;
                })}
              {row('20+ point games', 'Games with at least 20 DK points', (p) => (p.season_stats ? `${p.season_stats.games_20} of ${p.season_stats.games}` : '–'),
                chosen.map((p) => (p.season_stats ? p.season_stats.games_20 / p.season_stats.games : null)))}
              {row('Targets per game', 'Passes thrown his way', (p) => (p.season_stats && p.pos !== 'QB' ? fixed(p.season_stats.tgt) : '–'),
                chosen.map((p) => (p.pos !== 'QB' ? p.season_stats?.tgt : null)))}
              {row('Target share', 'Share of his team’s targets', (p) => (p.pos !== 'QB' && p.season_stats?.tgt_share != null ? pct(p.season_stats.tgt_share) : '–'),
                chosen.map((p) => (p.pos !== 'QB' ? p.season_stats?.tgt_share : null)))}
              {row('Carries per game', 'Rushing attempts', (p) => (p.season_stats ? fixed(p.season_stats.car) : '–'))}
            </tbody>
          </table>
        </div>
      )}

      {chosen.length >= 2 && result && (
        <>
          <h3>Head to head</h3>
          <ul className="h2h">
            {result.h2h.map((h) => {
              const [a, b] = [byId.get(h.a)!, byId.get(h.b)!];
              const [w, l, p] = h.pA >= 0.5 ? [a, b, h.pA] : [b, a, 1 - h.pA];
              return <li key={`${h.a}-${h.b}`}><b>{w.name}</b> outscores {l.name} in {pct(p)} of simulated games</li>;
            })}
          </ul>
        </>
      )}

      {chosen.some((p) => (p.log ?? []).length) && (
        <details className="panel">
          <summary>Game logs</summary>
          <div className="gllogs">
            {chosen.map((p) => (
              <div key={p.id}>
                <h4>{p.name}</h4>
                <GameLogTable p={p} />
              </div>
            ))}
          </div>
        </details>
      )}
      {chosen.length >= 2 && (
        <p className="muted small">
          Odds come from 2,000 simulated games using the same model as the Lineups tab: each player’s projection and volatility,
          bust games, and real-world links between teammates and opponents.
        </p>
      )}
    </section>
  );
}
