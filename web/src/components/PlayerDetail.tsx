import { useEffect, useMemo, type ReactNode } from 'react';
import { blurb, playerFacts } from '../lib/blurb';
import { compareOdds, ordinal } from '../lib/compare';
import { fixed, kickoff, money, signed, SOURCE_LABELS } from '../lib/format';
import type { SlateRanks } from '../lib/slateRanks';
import type { Slate } from '../types';
import { ChartLegend, GameLogChart, GameLogTable, matchupText, spreadText } from './PlayerContext';
import type { ValuedPlayer, ValueSettings, Weights } from '../lib/value';
import { StatusPill } from './PlayerTable';

const COMPONENTS: { key: keyof Weights; label: string; raw: (p: ValuedPlayer) => string; z: (p: ValuedPlayer) => number }[] = [
  { key: 'efficiency', label: 'Efficiency', raw: (p) => `${fixed(p.components!.efficiency, 2)} / $1K`, z: (p) => p.components!.z.efficiency },
  { key: 'positional', label: 'Positional', raw: (p) => `${signed(p.components!.positional, 1)} vs curve`, z: (p) => p.components!.z.positional },
  { key: 'budget', label: 'Budget impact', raw: (p) => `${signed(p.components!.budget, 1)} vs pace`, z: (p) => p.components!.z.budget },
  {
    key: 'reliability',
    label: 'Reliability',
    raw: (p) => {
      const c = p.components!;
      const cv = c.sourceCv != null ? `spread ${fixed(c.sourceCv * 100, 0)}%` : '1 source';
      return `${cv}, floor ${fixed((c.consistency ?? 0) * 100, 0)}%`;
    },
    z: (p) => p.components!.reliability,
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "3rd-lowest of 26", or from the other end when that reads better: "highest of 26". */
function rankWords(rank: number, of: number, word: string, opposite: string): string {
  const [r, w] = rank <= Math.ceil(of / 2) ? [rank, word] : [of - rank + 1, opposite];
  return `${r === 1 ? w : `${ordinal(r)}-${w}`} of ${of}`;
}

/** A labelled value with a muted comparison underneath or beside it. */
function KV({ label, value, note, title }: { label: string; value: ReactNode; note?: ReactNode; title?: string }) {
  return (
    <div className="kv" title={title}>
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
      {note && <span className="kv-note">{note}</span>}
    </div>
  );
}

export function PlayerDetail({ p, settings, tz, slate, ranks, onClose, onCompare }: {
  p: ValuedPlayer; settings: ValueSettings; tz: string; slate: Slate; ranks: SlateRanks; onClose: () => void; onCompare?: () => void;
}) {
  const odds = useMemo(() => (p.proj != null ? compareOdds([p], settings.targetTotal).odds[0] : null), [p, settings.targetTotal]);
  const summary = useMemo(() => blurb(playerFacts(p, ranks, odds), `${p.id}-${slate.week}`), [p, ranks, odds, slate.week]);
  const team = ranks.teams.get(p.team);
  const game = p.game ? slate.games.find((g) => g.game === p.game) : undefined;
  const gameRank = p.game ? ranks.games.get(p.game) : undefined;
  const mt = matchupText(p);
  const graded = (p.log ?? []).filter((g) => !g.dnp && g.proj != null);
  const beat = graded.filter((g) => g.actual > g.proj!).length;
  const gap = graded.length ? graded.reduce((s, g) => s + g.actual - g.proj!, 0) / graded.length : null;
  const ss = p.season_stats;
  const noData = p.log === undefined ? 'after the next data refresh' : '–';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sources = Object.entries(p.projections).sort((a, b) => b[1] - a[1]);
  const maxProj = Math.max(1, ...sources.map(([, v]) => v), p.proj ?? 0);
  const w = settings.weights;
  const wsum = w.efficiency + w.positional + w.budget + w.reliability || 1;

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="detail" role="dialog" aria-modal="true" aria-label={p.name} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>
              {p.name} <StatusPill status={p.status} conflict={p.status_conflict} />
            </h2>
            <p className="muted">
              {p.pos} · {p.team} {p.home ? 'vs' : '@'} {p.opp} · {kickoff(p.kickoff, tz)} · {money(p.salary)}
            </p>
            {onCompare && p.proj != null && (
              <button className="compare-btn" onClick={onCompare}>
                Compare
              </button>
            )}
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="summary">{summary}</p>

        <div className="stat-row">
          <div>
            <b>{fixed(p.proj)}</b>
            <span>Proj</span>
          </div>
          <div>
            <b>{fixed(p.floor)}</b>
            <span>Floor</span>
          </div>
          <div>
            <b>{signed(p.value)}</b>
            <span>Value{p.posRank ? ` · ${p.pos}${p.posRank}` : ''}</span>
          </div>
          <div>
            <b>{p.proj != null ? fixed(p.proj / (p.salary / 1000), 2) : '–'}</b>
            <span>Pts / $1K</span>
          </div>
        </div>
        {p.poolReason && <p className="warn">Not in value pool: {p.poolReason}</p>}

        {odds && (
          <>
            <h3>This week (simulated)</h3>
            <div className="kv-grid">
              <KV label="Bad day" value={fixed(odds.p10)} note="10th percentile" title="9 times in 10 he scores at least this" />
              <KV label="Median" value={fixed(odds.p50)} note="middle outcome" />
              <KV label="Great day" value={fixed(odds.p90)} note="90th percentile (ceiling)" title="His best 1 in 10 games" />
              <KV label="Reaches salary pace" value={pct(odds.pPace)} note={`needs ${fixed((p.salary * settings.targetTotal) / 50000)} (T = ${settings.targetTotal})`} />
            </div>
          </>
        )}

        <h3>Vegas</h3>
        {team ? (
          <div className="kv-grid">
            <KV label="Team total" value={fixed(team.implied)}
              note={`${ordinal(team.impliedRank)} of ${ranks.teamCount} teams · slate avg ${fixed(ranks.avgImplied)}`} />
            <KV label={`${p.opp ?? 'Opponent'} total`} value={fixed(team.oppImplied)}
              note={rankWords(team.oppImpliedRank, ranks.teamCount, 'lowest', 'highest')} />
            <KV label="Spread" value={spreadText(game, p.team)}
              note={team.favoriteRank ? `${team.favoriteRank === 1 ? 'biggest' : `${ordinal(team.favoriteRank)}-biggest`} favorite of ${ranks.favorites}` : undefined} />
            <KV label="Game total" value={fixed(gameRank?.total)}
              note={gameRank ? `${gameRank.totalRank === 1 ? 'highest' : `${ordinal(gameRank.totalRank)}-highest`} of ${ranks.gameCount} games · avg ${fixed(ranks.avgTotal)}` : undefined} />
            {team.share != null && <KV label="Share of game points" value={pct(team.share)} note={`${p.team} expected points ÷ game total`} />}
          </div>
        ) : (
          <p className="muted small">No betting lines for this game yet.</p>
        )}

        <h3>Matchup</h3>
        <p className="small">
          {p.home ? 'vs' : '@'} {p.opp} · {kickoff(p.kickoff, tz)}
          {mt ? <><br />{mt.main} <span className="muted">· {mt.sub}</span></> : <span className="muted"> · matchup data {noData}</span>}
        </p>

        {p.pos !== 'DST' && (
          <>
            <h3>Recent performance</h3>
            {p.log && p.log.length > 0 ? (
              <>
                <div className="recent">
                  <GameLogChart log={p.log} name={p.name} />
                  <div className="kv-grid narrow">
                    <KV label="vs our projection" value={gap != null ? signed(gap, 1) : '–'}
                      note={graded.length ? `beat it in ${beat} of ${graded.length} games` : 'no graded games yet'} />
                    <KV label="Average DK points" value={fixed(ss?.avg)} note={ss ? `${ss.games} games this season` : undefined} />
                  </div>
                </div>
                <ChartLegend />
                <details className="panel gl-details">
                  <summary>Game log</summary>
                  <div className="scroll-x"><GameLogTable p={p} /></div>
                </details>
              </>
            ) : (
              <p className="muted small">Game log {noData}.</p>
            )}

            <h3>Usage</h3>
            <div className="kv-grid">
              {p.pos !== 'QB' && <KV label="Targets per game" value={fixed(ss?.tgt)} />}
              {p.pos !== 'QB' && <KV label="Target share" value={ss?.tgt_share != null ? pct(ss.tgt_share) : '–'} note="of his team's targets" />}
              {(p.pos === 'RB' || p.pos === 'QB') && <KV label="Carries per game" value={fixed(ss?.car)} />}
              <KV label="20+ point games" value={ss ? `${ss.games_20} of ${ss.games}` : '–'} />
              <KV label="From touchdowns" value={p.td_pts != null && p.proj ? pct(p.td_pts / p.proj) : '–'} note="share of projection" />
            </div>
          </>
        )}

        <h3>Projections by source</h3>
        <ul className="bars">
          {sources.map(([src, v]) => (
            <li key={src}>
              <span className="bar-label">
                {SOURCE_LABELS[src] ?? src}
                {p.match[src] && p.match[src] !== 'id' && p.match[src] !== 'team' && <small className="muted"> ({p.match[src]})</small>}
              </span>
              <span className="bar">
                <span style={{ width: `${(v / maxProj) * 100}%` }} />
              </span>
              <span className="bar-val">{fixed(v)}</span>
            </li>
          ))}
          {p.proj != null && (
            <li className="consensus">
              <span className="bar-label">Consensus</span>
              <span className="bar">
                <span style={{ width: `${(p.proj / maxProj) * 100}%` }} />
              </span>
              <span className="bar-val">{fixed(p.proj)}</span>
            </li>
          )}
          {p.missing_sources.map((src) => (
            <li key={src} className="missing">
              <span className="bar-label">{SOURCE_LABELS[src] ?? src}</span>
              <span className="muted">no projection</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Spread ±{fixed(p.proj_sd)} · range {fixed(p.proj_min)}–{fixed(p.proj_max)} · volatility (CV) {fixed((p.cv ?? 0) * 100, 0)}%
          {p.hist_games ? ` from ${p.hist_games} games (avg ${fixed(p.hist_mean)})` : ' (position prior)'}
        </p>

        {p.components && (
          <>
            <h3>Value components</h3>
            <table className="mini components">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Raw</th>
                  <th className="num">z</th>
                  <th className="num">Weight</th>
                  <th className="num">Contrib.</th>
                </tr>
              </thead>
              <tbody>
                {COMPONENTS.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td className="small">{c.raw(p)}</td>
                    <td className="num">{signed(c.z(p))}</td>
                    <td className="num">{Math.round((w[c.key] / wsum) * 100)}%</td>
                    <td className="num">{signed((c.z(p) * w[c.key]) / wsum)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={4}>Value</td>
                  <td className="num">{signed(p.value)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <h3>Status</h3>
        <p className="small">
          {Object.entries(p.status_detail)
            .map(([src, s]) => `${src}: ${s}`)
            .join(' · ')}
          {p.status_conflict && ' · sources disagree'}
        </p>
      </aside>
    </div>
  );
}
