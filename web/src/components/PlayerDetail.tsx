import { useEffect } from 'react';
import { fixed, kickoff, money, signed, SOURCE_LABELS } from '../lib/format';
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

export function PlayerDetail({ p, settings, tz, onClose, onCompare }: {
  p: ValuedPlayer; settings: ValueSettings; tz: string; onClose: () => void; onCompare?: () => void;
}) {
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
            <b>{fixed(p.team_total)}</b>
            <span>Team total</span>
          </div>
        </div>
        {p.poolReason && <p className="warn">Not in value pool: {p.poolReason}</p>}

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
