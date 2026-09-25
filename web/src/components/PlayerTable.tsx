import type { ReactNode } from 'react';
import { fixed, money, signed, STATUS_LABELS } from '../lib/format';
import type { ValuedPlayer } from '../lib/value';

export type SortKey = 'name' | 'pos' | 'salary' | 'proj' | 'floor' | 'eff' | 'value' | 'zEff' | 'zPos' | 'zBud' | 'rel' | 'src';
export interface Sort {
  key: SortKey;
  desc: boolean;
}

const ACCESSORS: Record<SortKey, (p: ValuedPlayer) => number | string | null> = {
  name: (p) => p.name,
  pos: (p) => p.pos,
  salary: (p) => p.salary,
  proj: (p) => p.proj,
  floor: (p) => p.floor,
  eff: (p) => p.components?.efficiency ?? null,
  value: (p) => p.value,
  zEff: (p) => p.components?.z.efficiency ?? null,
  zPos: (p) => p.components?.z.positional ?? null,
  zBud: (p) => p.components?.z.budget ?? null,
  rel: (p) => p.components?.reliability ?? null,
  src: (p) => p.n_sources,
};

const COLUMNS: { key: SortKey; label: string; title: string; className?: string }[] = [
  { key: 'value', label: 'Value', title: 'Weighted value score (z-units within position)', className: 'num value-col' },
  { key: 'salary', label: 'Salary', title: 'DraftKings salary', className: 'num' },
  { key: 'proj', label: 'Proj', title: 'Consensus DraftKings points (± spread across sources)', className: 'num' },
  { key: 'floor', label: 'Floor', title: '~20th percentile outcome from historical volatility', className: 'num' },
  { key: 'eff', label: 'Pts/$K', title: 'Projected points per $1,000', className: 'num' },
  { key: 'zEff', label: 'Eff', title: 'Efficiency z-score', className: 'num comp' },
  { key: 'zPos', label: 'PosV', title: 'Points above salary curve, z-score', className: 'num comp' },
  { key: 'zBud', label: 'Budg', title: 'Points surplus vs target pace, z-score', className: 'num comp' },
  { key: 'rel', label: 'Rel', title: 'Reliability: source agreement + floor ratio − Q penalty', className: 'num comp' },
  { key: 'src', label: 'Src', title: 'Number of projection sources', className: 'num' },
  { key: 'pos', label: 'Pos', title: 'Position' },
];

export function sortPlayers(players: ValuedPlayer[], sort: Sort): ValuedPlayer[] {
  const get = ACCESSORS[sort.key];
  return [...players].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // nulls last regardless of direction
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    return sort.desc ? -c : c;
  });
}

function zClass(z: number | null | undefined): string {
  if (z == null) return '';
  if (z >= 1) return 'z-hi2';
  if (z >= 0.35) return 'z-hi';
  if (z <= -1) return 'z-lo2';
  if (z <= -0.35) return 'z-lo';
  return '';
}

function ValueBar({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">–</span>;
  const pct = Math.max(0, Math.min(100, ((v + 2) / 4) * 100));
  return (
    <span className="vbar" title={signed(v)}>
      <span className={`vbar-fill ${v >= 0 ? 'pos' : 'neg'}`} style={{ width: `${pct}%` }} />
      <span className="vbar-text">{signed(v)}</span>
    </span>
  );
}

export function StatusPill({ status, conflict }: { status: string; conflict?: boolean }) {
  if (status === 'ACTIVE' && !conflict) return null;
  return (
    <span className={`pill st-${status}`} title={conflict ? 'Sources disagree on status' : undefined}>
      {STATUS_LABELS[status] || '!'}
      {conflict ? '*' : ''}
    </span>
  );
}

export function PlayerTable({ players, sort, onSort, onSelect, actions, rowClass }: {
  players: ValuedPlayer[];
  sort: Sort;
  onSort: (s: Sort) => void;
  onSelect: (p: ValuedPlayer) => void;
  actions?: (p: ValuedPlayer) => ReactNode;
  rowClass?: (p: ValuedPlayer) => string;
}) {
  const header = (key: SortKey, label: string, title: string, className = '') => (
    <th
      key={key}
      className={`${className} sortable ${sort.key === key ? 'sorted' : ''}`}
      title={title}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => onSort({ key, desc: sort.key === key ? !sort.desc : key !== 'name' && key !== 'pos' })}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  );

  return (
    <div className="table-wrap">
      <table className="players">
        <thead>
          <tr>
            {header('name', 'Player', 'Player', 'sticky')}
            {COLUMNS.map((c) => header(c.key, c.label, c.title, c.className))}
            {actions && <th className="actions-col">Lineup</th>}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const c = p.components;
            return (
              <tr key={p.id} className={`${p.inValuePool ? '' : 'out-of-pool'} ${rowClass?.(p) ?? ''}`} onClick={() => onSelect(p)}>
                <td className="sticky player-cell">
                  <span className="pname">
                    {p.name} <StatusPill status={p.status} conflict={p.status_conflict} />
                  </span>
                  <span className="psub">
                    {p.pos} · {p.team} {p.home ? 'vs' : '@'} {p.opp}
                    {p.late ? ' · late' : ''}
                    {p.poolReason ? ` · ${p.poolReason}` : ''}
                  </span>
                </td>
                <td className="num value-col">
                  <ValueBar v={p.value} />
                </td>
                <td className="num">{money(p.salary)}</td>
                <td className="num">
                  {fixed(p.proj)}
                  {p.proj_sd != null && <small className="muted"> ±{fixed(p.proj_sd)}</small>}
                </td>
                <td className="num">{fixed(p.floor)}</td>
                <td className="num">{fixed(c?.efficiency, 2)}</td>
                <td className={`num comp ${zClass(c?.z.efficiency)}`}>{signed(c?.z.efficiency, 1)}</td>
                <td className={`num comp ${zClass(c?.z.positional)}`}>{signed(c?.z.positional, 1)}</td>
                <td className={`num comp ${zClass(c?.z.budget)}`}>{signed(c?.z.budget, 1)}</td>
                <td className={`num comp ${zClass(c?.reliability)}`}>{signed(c?.reliability, 1)}</td>
                <td className="num">{p.n_sources}</td>
                <td>{p.pos}</td>
                {actions && (
                  <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                    {actions(p)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {players.length === 0 && <p className="empty">No players match these filters.</p>}
    </div>
  );
}
