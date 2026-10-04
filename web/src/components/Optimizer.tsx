import { useEffect, useRef, useState } from 'react';
import { fixed, money, signed } from '../lib/format';
import type { OptimizerOptions, Solver } from '../lib/optimizer';
import { SIMS } from '../lib/sim';
import { buildLineups, type RankedLineup, type StrategyResult } from '../lib/strategies';
import type { ValuedPlayer } from '../lib/value';
import { SALARY_CAP } from '../lib/value';
import { StatusPill } from './PlayerTable';

let solverPromise: Promise<Solver> | null = null;
export function loadSolver(): Promise<Solver> {
  // ~200 KB of WebAssembly; only loaded when the optimizer is opened.
  solverPromise ??= import('glpk.js').then((m) => m.default() as unknown as Promise<Solver>);
  return solverPromise;
}

export interface LineupControls {
  locks: string[];
  excludes: string[];
  toggleLock: (id: string) => void;
  toggleExclude: (id: string) => void;
  clear: () => void;
}

export function LockButtons({ id, ctl }: { id: string; ctl: LineupControls }) {
  const locked = ctl.locks.includes(id);
  const excluded = ctl.excludes.includes(id);
  return (
    <span className="lock-buttons">
      <button className={locked ? 'on' : ''} title={locked ? 'Unlock' : 'Lock into lineups'} aria-pressed={locked} onClick={() => ctl.toggleLock(id)}>
        Lock
      </button>
      <button className={excluded ? 'on bad' : ''} title={excluded ? 'Allow' : 'Exclude from lineups'} aria-pressed={excluded} onClick={() => ctl.toggleExclude(id)}>
        Excl
      </button>
    </span>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function LineupCard({ lineup, index, best, ctl, onSelect, options }: {
  lineup: RankedLineup; index: number; best: RankedLineup; ctl: LineupControls; onSelect: (p: ValuedPlayer) => void;
  options: OptimizerOptions;
}) {
  const bestIds = new Set(best.slots.map((s) => s.player.id));
  const st = lineup.stats;
  const safe = options.mode === 'safe';
  return (
    <article className="lineup">
      <header>
        <h3>{index === 0 ? 'Best lineup' : `Alternative ${index}`}</h3>
        <span className="lineup-totals">
          {safe ? (
            <><b>{pct(st.pTarget)}</b> chance of {options.target}+ · </>
          ) : (
            <><b>{fixed(st.p90)}</b> ceiling (90th pct) · </>
          )}
          {fixed(lineup.proj)} proj · {money(lineup.salary)}
          <span className="muted"> ({money(SALARY_CAP - lineup.salary)} left)</span>
          {index > 0 && (
            <span className="muted">
              {' '}· {safe ? `${signed((st.pTarget - best.stats.pTarget) * 100, 0)} pts of chance` : `${signed(st.p90 - best.stats.p90, 1)} ceiling`} vs best
            </span>
          )}
        </span>
      </header>
      <p className="lineup-range small">
        <span title="1 in 10 simulated slates score below this">Floor (10th pct) <b>{fixed(st.p10)}</b></span>
        <span>Median <b>{fixed(st.p50)}</b></span>
        <span title="1 in 10 simulated slates score above this">Ceiling (90th pct) <b>{fixed(st.p90)}</b></span>
        <span className="muted">{lineup.note}</span>
      </p>
      <div className="scroll-x">
        <table className="mini lineup-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Player</th>
              <th className="num">Salary</th>
              <th className="num">Proj</th>
              <th className="num">Floor</th>
              <th className="num">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineup.slots.map(({ slot, player }) => {
              const p = player as ValuedPlayer;
              return (
                <tr key={p.id} className={index > 0 && !bestIds.has(p.id) ? 'swap' : ''}>
                  <td className="slot">{slot}</td>
                  <td className="lp-name" onClick={() => onSelect(p)}>
                    <b>{p.name}</b> <StatusPill status={p.status} conflict={p.status_conflict} />
                    <span className="psub">
                      {p.pos} · {p.team} {p.home ? 'vs' : '@'} {p.opp}
                      {p.late ? ' · late' : ''}
                    </span>
                  </td>
                  <td className="num">{money(p.salary)}</td>
                  <td className="num">{fixed(p.proj)}</td>
                  <td className="num muted">{fixed(p.floor)}</td>
                  <td className="num">{signed(p.value, 2)}</td>
                  <td>
                    <LockButtons id={p.id} ctl={ctl} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function Optimizer({ players, options, onOptions, ctl, onSelect, onUseTotal }: {
  players: ValuedPlayer[];
  options: OptimizerOptions;
  onOptions: (o: OptimizerOptions) => void;
  ctl: LineupControls;
  onSelect: (p: ValuedPlayer) => void;
  onUseTotal: (total: number) => void;
}) {
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  const set = <K extends keyof OptimizerOptions>(k: K, v: OptimizerOptions[K]) => onOptions({ ...options, [k]: v });

  useEffect(() => {
    const id = ++runId.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const glpk = await loadSolver();
        const res = await buildLineups(players, { ...options, locks: ctl.locks, excludes: ctl.excludes }, glpk);
        if (id === runId.current) {
          setResult(res);
          setError(null);
        }
      } catch (e) {
        if (id === runId.current) setError((e as Error).message);
      } finally {
        if (id === runId.current) setBusy(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [players, options, ctl.locks, ctl.excludes]);

  const byId = new Map(players.map((p) => [p.id, p]));
  const best = result?.lineups[0];

  return (
    <section className="optimizer">
      <div className="modes" role="radiogroup" aria-label="Lineup mode">
        <button role="radio" aria-checked={options.mode !== 'upside'} className={`mode ${options.mode !== 'upside' ? 'on' : ''}`} onClick={() => set('mode', 'safe')}>
          <b>Safest (cash)</b>
          <span>Best chance of reaching a target score. Judges the whole lineup on {SIMS.toLocaleString()} simulated slates where
            teammates and opponents rise and fall together, so it spreads risk instead of adding up individual floors.</span>
        </button>
        <button role="radio" aria-checked={options.mode === 'upside'} className={`mode ${options.mode === 'upside' ? 'on' : ''}`} onClick={() => set('mode', 'upside')}>
          <b>Highest potential</b>
          <span>Highest 90th-percentile score. A QB with two of his pass-catchers and one player from the other team, from the
            highest-total games, favouring touchdown scorers.</span>
        </button>
      </div>
      {options.mode !== 'upside' && (
        <div className="row-inputs">
          <label title="The score you need, e.g. a typical double-up cash line">
            Target score <input type="number" min={60} max={250} value={options.target} onChange={(e) => set('target', Math.max(60, Math.min(250, +e.target.value || 125)))} />
          </label>
        </div>
      )}
      <details className="panel">
        <summary>Optimizer settings {busy && <span className="muted">· solving…</span>}</summary>
        <div className="opt-grid">
          <fieldset>
            <legend>Output</legend>
            <label className="inline">
              Lineups
              <input type="number" min={1} max={20} value={options.count} onChange={(e) => set('count', Math.max(1, Math.min(20, +e.target.value || 1)))} />
            </label>
            <label className="inline" title="Each alternative must differ from every earlier lineup by at least this many players">
              Min. different players
              <input type="number" min={1} max={5} value={options.minDiff} onChange={(e) => set('minDiff', Math.max(1, Math.min(5, +e.target.value || 1)))} />
            </label>
            <label className="inline">
              Min. salary
              <input type="number" min={0} max={50000} step={100} value={options.minSalary || ''} placeholder="off" onChange={(e) => set('minSalary', +e.target.value || 0)} />
            </label>
          </fieldset>
          <fieldset>
            <legend>Rules</legend>
            <label className="check">
              <input type="checkbox" checked={options.noOffenseVsDst} onChange={(e) => set('noOffenseVsDst', e.target.checked)} /> No offense vs my DST
            </label>
            {options.mode !== 'upside' && (
              <label className="check">
                <input type="checkbox" checked={options.qbStack} onChange={(e) => set('qbStack', e.target.checked)} /> QB + own WR/TE
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={options.allowQuestionable} onChange={(e) => set('allowQuestionable', e.target.checked)} /> Allow Q players
            </label>
          </fieldset>
        </div>
        {(ctl.locks.length > 0 || ctl.excludes.length > 0) && (
          <div className="lock-summary">
            {ctl.locks.map((id) => byId.get(id) && (
              <button key={id} className="tag on" onClick={() => ctl.toggleLock(id)} title="Unlock">
                Locked: {byId.get(id)!.name} ×
              </button>
            ))}
            {ctl.excludes.map((id) => byId.get(id) && (
              <button key={id} className="tag bad" onClick={() => ctl.toggleExclude(id)} title="Allow">
                Excluded: {byId.get(id)!.name} ×
              </button>
            ))}
            <button className="link" onClick={ctl.clear}>
              Clear all
            </button>
          </div>
        )}
      </details>

      {error && <p className="warn">Optimizer error: {error}</p>}
      {result?.warnings.map((w) => (
        <p key={w} className="warn">
          {w}
        </p>
      ))}
      {busy && !result && <p className="muted">Building and simulating lineups…</p>}
      {best && (
        <p className="muted small">
          {result!.pool} eligible players · {result!.candidates} candidate lineups compared on {SIMS.toLocaleString()} simulated
          slates{busy ? ' · updating…' : ''}. Best lineup projects {fixed(best.proj)}.{' '}
          <button className="link" onClick={() => onUseTotal(Math.round(best.proj))}>
            Use {Math.round(best.proj)} as target total T
          </button>
        </p>
      )}
      {result?.lineups.map((l, i) => (
        <LineupCard key={l.slots.map((s) => s.player.id).join()} lineup={l} index={i} best={best!} ctl={ctl} onSelect={onSelect} options={options} />
      ))}
    </section>
  );
}
