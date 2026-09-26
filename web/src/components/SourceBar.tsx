import { useState } from 'react';
import { ago } from '../lib/format';
import type { SourcesReport } from '../types';

const KIND_ORDER = { salaries: 0, projections: 1, status: 2, reference: 3 };
const SHORT: Record<string, string> = {
  draftkings: 'DK salaries', draftkings_csv: 'DK CSV', sleeper: 'Sleeper', espn: 'ESPN',
  cbs: 'CBS', vegas_dst: 'Vegas DST',
  draftsharks: 'DraftSharks', rotoballer: 'RotoBaller', fantasyknockout: 'Fantasy Knockout', yahoo: 'Yahoo',
  pff: 'PFF', bettingpros: 'BettingPros', fantasysixpack: 'Fantasy Six Pack', sleeper_status: 'Injuries', nflverse_ids: 'IDs', nflverse_schedule: 'Schedule',
  nflverse_stats: 'History',
};

export function SourceBar({ report }: { report: SourcesReport }) {
  const [open, setOpen] = useState(false);
  const sources = [...report.sources].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const problems = sources.filter((s) => s.status === 'failed' || s.status === 'stale');
  const unmatched = Object.entries(report.match_report.unmatched ?? {}).filter(([, v]) => v.length);
  const noProj = report.match_report.no_projection ?? [];

  return (
    <section className="sources" aria-label="Data sources">
      <button className="source-chips" onClick={() => setOpen(!open)} aria-expanded={open}>
        {sources
          .filter((s) => s.status !== 'disabled' && (s.kind !== 'reference' || s.status !== 'ok'))
          .map((s) => (
            <span key={s.name} className={`chip status-${s.status}`} title={s.error ?? s.label}>
              <span className="dot" aria-hidden />
              {SHORT[s.name] ?? s.label}
              <span className="chip-age">{s.status === 'ok' ? ago(s.fetched_at) : s.status}</span>
            </span>
          ))}
        <span className="chip-more">{open ? 'Hide' : 'Details'}</span>
      </button>
      {problems.length > 0 && !open && (
        <p className="warn">
          {problems.map((s) => (s.status === 'stale' ? `${s.label}: using data from ${s.stale_hours}h ago` : `${s.label}: failed`)).join(' · ')}
        </p>
      )}
      {open && (
        <div className="source-detail">
          <div className="scroll-x">
            <table className="mini">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="num">Rows</th>
                  <th className="num">Coverage</th>
                  <th>Access</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name}>
                    <td>{s.label}</td>
                    <td>
                      <span className={`pill status-${s.status}`}>{s.status}</span>
                    </td>
                    <td>{ago(s.fetched_at)}</td>
                    <td className="num">{s.rows || ''}</td>
                    <td className="num">{s.coverage != null ? `${Math.round(s.coverage * 100)}%` : ''}</td>
                    <td>{s.access}</td>
                    <td className="detail">{[s.error, ...s.notes].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(unmatched.length > 0 || noProj.length > 0) && (
            <details className="match-report">
              <summary>
                Match report: {unmatched.reduce((n, [, v]) => n + v.length, 0)} unmatched, {noProj.length} relevant players with no projection
              </summary>
              {unmatched.map(([src, rows]) => (
                <p key={src}>
                  <b>{src}:</b> {rows.map((r) => `${r.name} (${r.pos} ${r.team}, ${r.points})`).join(', ')}
                </p>
              ))}
              {noProj.length > 0 && (
                <p>
                  <b>No projection:</b> {noProj.map((r) => `${r.name} (${r.pos} ${r.team})`).join(', ')}
                </p>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
