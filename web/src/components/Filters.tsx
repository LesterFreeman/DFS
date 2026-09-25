import type { ValuedPlayer } from '../lib/value';

export type PosFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'DST';

export interface FilterState {
  pos: PosFilter;
  team: string;
  search: string;
  salaryMin: string;
  salaryMax: string;
  projMin: string;
  projMax: string;
  valueMin: string;
  valueMax: string;
  showActive: boolean;
  showQuestionable: boolean;
  showOut: boolean;
  poolOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  pos: 'ALL',
  team: '',
  search: '',
  salaryMin: '',
  salaryMax: '',
  projMin: '',
  projMax: '',
  valueMin: '',
  valueMax: '',
  showActive: true,
  showQuestionable: true,
  showOut: false,
  poolOnly: false,
};

const num = (s: string) => (s.trim() === '' || Number.isNaN(+s) ? null : +s);

export function applyFilters(players: ValuedPlayer[], f: FilterState): ValuedPlayer[] {
  const q = f.search.trim().toLowerCase();
  const [sMin, sMax, pMin, pMax, vMin, vMax] = [f.salaryMin, f.salaryMax, f.projMin, f.projMax, f.valueMin, f.valueMax].map(num);
  return players.filter((p) => {
    if (f.pos === 'FLEX' ? !['RB', 'WR', 'TE'].includes(p.pos) : f.pos !== 'ALL' && p.pos !== f.pos) return false;
    if (f.team && p.team !== f.team) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (sMin != null && p.salary < sMin) return false;
    if (sMax != null && p.salary > sMax) return false;
    if (pMin != null && (p.proj ?? -1) < pMin) return false;
    if (pMax != null && (p.proj ?? Infinity) > pMax) return false;
    if (vMin != null && (p.value ?? -99) < vMin) return false;
    if (vMax != null && (p.value ?? 99) > vMax) return false;
    const group = p.status === 'ACTIVE' ? 'active' : p.status === 'Q' ? 'q' : 'out';
    if (group === 'active' && !f.showActive) return false;
    if (group === 'q' && !f.showQuestionable) return false;
    if (group === 'out' && !f.showOut) return false;
    if (f.poolOnly && !p.inValuePool) return false;
    return true;
  });
}

function Range({ label, min, max, onMin, onMax, step }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; step: number;
}) {
  return (
    <fieldset className="range">
      <legend>{label}</legend>
      <input type="number" inputMode="decimal" placeholder="min" step={step} value={min} onChange={(e) => onMin(e.target.value)} />
      <span>–</span>
      <input type="number" inputMode="decimal" placeholder="max" step={step} value={max} onChange={(e) => onMax(e.target.value)} />
    </fieldset>
  );
}

export function Filters({ f, onChange, teams, count }: {
  f: FilterState; onChange: (f: FilterState) => void; teams: string[]; count: number;
}) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...f, [k]: v });
  const active = JSON.stringify({ ...f, pos: 'ALL', search: '' }) !== JSON.stringify({ ...DEFAULT_FILTERS, pos: 'ALL', search: '' });
  return (
    <div className="filters">
      <div className="pos-tabs" role="tablist">
        {(['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'] as PosFilter[]).map((p) => (
          <button key={p} role="tab" aria-selected={f.pos === p} className={f.pos === p ? 'on' : ''} onClick={() => set('pos', p)}>
            {p === 'ALL' ? 'All' : p}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <input className="search" type="search" placeholder="Search player" value={f.search} onChange={(e) => set('search', e.target.value)} />
        <select value={f.team} onChange={(e) => set('team', e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <details className="panel">
        <summary>
          More filters {active && <span className="muted">(active)</span>} <span className="muted">· {count} shown</span>
        </summary>
        <div className="filter-grid">
          <Range label="Salary" step={100} min={f.salaryMin} max={f.salaryMax} onMin={(v) => set('salaryMin', v)} onMax={(v) => set('salaryMax', v)} />
          <Range label="Projection" step={1} min={f.projMin} max={f.projMax} onMin={(v) => set('projMin', v)} onMax={(v) => set('projMax', v)} />
          <Range label="Value" step={0.1} min={f.valueMin} max={f.valueMax} onMin={(v) => set('valueMin', v)} onMax={(v) => set('valueMax', v)} />
          <fieldset className="checks">
            <legend>Status</legend>
            <label className="check">
              <input type="checkbox" checked={f.showActive} onChange={(e) => set('showActive', e.target.checked)} /> Active
            </label>
            <label className="check">
              <input type="checkbox" checked={f.showQuestionable} onChange={(e) => set('showQuestionable', e.target.checked)} /> Questionable
            </label>
            <label className="check">
              <input type="checkbox" checked={f.showOut} onChange={(e) => set('showOut', e.target.checked)} /> Doubtful / Out / IR
            </label>
            <label className="check">
              <input type="checkbox" checked={f.poolOnly} onChange={(e) => set('poolOnly', e.target.checked)} /> Value pool only
            </label>
          </fieldset>
        </div>
        {active && (
          <button className="link" onClick={() => onChange({ ...DEFAULT_FILTERS, pos: f.pos, search: f.search })}>
            Reset filters
          </button>
        )}
      </details>
    </div>
  );
}
