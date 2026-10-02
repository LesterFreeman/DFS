import { useEffect, useMemo, useState } from 'react';
import { loadBacktest, POSITIONS, valueQuality, weekLineups, type LineupOutcome } from '../lib/backtest';
import { fixed, money, signed, SOURCE_LABELS } from '../lib/format';
import type { OptimizerOptions } from '../lib/optimizer';
import { useStored } from '../lib/storage';
import { PRESETS, type ValueSettings } from '../lib/value';
import type { Backtest as BacktestData, BacktestMetrics, BacktestWeek } from '../types';
import { loadSolver } from './Optimizer';

const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const weekName = (w: BacktestWeek) => `${w.season} Week ${w.week}`;

function ProjectionTable({ m }: { m: BacktestMetrics }) {
  const cols = ['ALL', ...POSITIONS].filter((c) => m.projection.consensus?.[c]);
  const sources = ['consensus', ...Object.keys(m.projection).filter((s) => s !== 'consensus')];
  return (
    <div className="scroll-x">
      <table className="mini">
        <thead>
          <tr>
            <th>Source</th>
            {cols.map((c) => <th key={c} className="num">{c === 'ALL' ? 'All' : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s}>
              <td>{s === 'consensus' ? <b>Consensus</b> : SOURCE_LABELS[s] ?? s}</td>
              {cols.map((c) => {
                const st = m.projection[s]?.[c];
                if (!st?.n) return <td key={c} className="num muted">–</td>;
                const better = st.mae_consensus != null && st.mae! < st.mae_consensus;
                return (
                  <td key={c} className="num" title={`${st.n} players · bias ${signed(st.bias, 1)} · RMSE ${fixed(st.rmse)} · corr ${fixed(st.corr, 2)}${st.mae_consensus != null ? ` · consensus on the same players ${fixed(st.mae_consensus)}` : ''}`}>
                    {better ? <b>{fixed(st.mae)}</b> : fixed(st.mae)}
                    <span className="psub">{signed(st.bias, 1)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FloorTable({ m }: { m: BacktestMetrics }) {
  const cols = ['ALL', ...POSITIONS].filter((c) => m.floor[c]);
  const verdict = (share: number, n: number) => {
    if (n < 10) return 'too few players';
    if (share > m.floor_target + 0.07) return 'floors too high';
    if (share < m.floor_target - 0.07) return 'floors too cautious';
    return 'on target';
  };
  return (
    <div className="scroll-x">
      <table className="mini">
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c} className="num">{c === 'ALL' ? 'All' : c}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Scored below floor</td>
            {cols.map((c) => <td key={c} className="num"><b>{pct(m.floor[c].share)}</b><span className="psub">{m.floor[c].below}/{m.floor[c].n}</span></td>)}
          </tr>
          <tr>
            <td>Verdict (target {pct(m.floor_target)})</td>
            {cols.map((c) => <td key={c} className="num small">{verdict(m.floor[c].share, m.floor[c].n)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ValueTable({ weeks, settings }: { weeks: BacktestWeek[]; settings: ValueSettings }) {
  const rows = useMemo(() => {
    const same = (a: ValueSettings['weights']) =>
      (Object.keys(a) as (keyof typeof a)[]).every((k) => Math.abs(a[k] - settings.weights[k]) < 1e-9);
    const named = Object.entries(PRESETS).map(([name, weights]) => ({ name, mine: same(weights), q: valueQuality(weeks, { ...settings, weights }) }));
    if (!named.some((r) => r.mine)) named.push({ name: 'Your current weights', mine: true, q: valueQuality(weeks, settings) });
    return named;
  }, [weeks, settings]);
  return (
    <div className="scroll-x">
      <table className="mini">
        <thead>
          <tr>
            <th>Weights</th>
            <th className="num" title="Rank correlation between value and actual points above salary pace, within position">Rank corr. (surplus)</th>
            <th className="num" title="Rank correlation between value and actual points per $1K, within position">Rank corr. (pts/$1K)</th>
            <th className="num" title={`Share of each position's top ${rows[0]?.q.topN} by value who reached salary pace`}>Top-{rows[0]?.q.topN} hit pace</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={r.mine ? 'locked' : ''}>
              <td>{r.name}{r.mine ? ' (in use)' : ''}</td>
              <td className="num">{fixed(r.q.corrSurplus, 2)}</td>
              <td className="num">{fixed(r.q.corrPerK, 2)}</td>
              <td className="num">{pct(r.q.topHitRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineupRow({ l, cashLine }: { l: LineupOutcome; cashLine: number }) {
  const [open, setOpen] = useState(false);
  const cashed = l.actual >= cashLine;
  return (
    <>
      <tr onClick={() => setOpen(!open)} className="clickable">
        <td>{open ? '▾' : '▸'} {l.label}</td>
        <td className="num">{fixed(l.proj)}</td>
        <td className="num muted">{fixed(l.floor)}</td>
        <td className="num"><b>{fixed(l.actual)}</b></td>
        <td className="num">{l.label === 'Hindsight best' ? '' : cashed ? <span className="good">✓ cashed</span> : <span className="bad-text">✗ {fixed(l.actual - cashLine)}</span>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="detail">
            <table className="mini">
              <tbody>
                {l.players.map((p) => (
                  <tr key={p.id}>
                    <td>{p.pos}</td>
                    <td>{p.name} <span className="muted">{p.team}</span></td>
                    <td className="num">{money(p.salary)}</td>
                    <td className="num muted">{fixed(p.proj)}</td>
                    <td className="num">{fixed(p.actual)}{!p.played && <span className="muted"> DNP</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function Lineups({ weeks, options, cashLine }: { weeks: BacktestWeek[]; options: OptimizerOptions; cashLine: number }) {
  const [results, setResults] = useState<{ week: BacktestWeek; lineups: LineupOutcome[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setResults(null);
    (async () => {
      try {
        const glpk = await loadSolver();
        const out = [];
        for (const week of weeks) out.push({ week, lineups: await weekLineups(week, options, glpk) });
        if (live) setResults(out);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [weeks, options]);
  if (error) return <p className="warn">Optimizer error: {error}</p>;
  if (!results) return <p className="muted">Solving…</p>;
  const tally = new Map<string, { cashed: number; n: number; actual: number }>();
  for (const { lineups } of results) {
    for (const l of lineups) {
      const t = tally.get(l.label) ?? { cashed: 0, n: 0, actual: 0 };
      tally.set(l.label, { cashed: t.cashed + (l.actual >= cashLine ? 1 : 0), n: t.n + 1, actual: t.actual + l.actual });
    }
  }
  return (
    <>
      {results.length > 1 && (
        <p className="small">
          {[...tally].filter(([k]) => k !== 'Hindsight best').map(([k, t]) => `${k}: cashed ${t.cashed}/${t.n}, average ${fixed(t.actual / t.n)}`).join(' · ')}
        </p>
      )}
      {results.map(({ week, lineups }) => (
        <div key={weekName(week)} className="scroll-x">
          <table className="mini lineup-table">
            <thead>
              <tr>
                <th>{weekName(week)}{week.backfilled ? ' (backfilled)' : ''}</th>
                <th className="num">Proj</th>
                <th className="num">Floor</th>
                <th className="num">Actual</th>
                <th className="num">vs {cashLine}</th>
              </tr>
            </thead>
            <tbody>
              {lineups.map((l) => <LineupRow key={l.label} l={l} cashLine={cashLine} />)}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

export function Backtest({ settings, options }: { settings: ValueSettings; options: OptimizerOptions }) {
  const [data, setData] = useState<BacktestData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useStored<{ week: string; cashLine: number }>('dfs.backtest', { week: 'all', cashLine: 130 });

  useEffect(() => {
    loadBacktest().then(setData, (e: Error) => setError(e.message));
  }, []);

  const weeks = useMemo(() => {
    if (!data) return [];
    return view.week === 'all' ? data.weeks : data.weeks.filter((w) => weekName(w) === view.week);
  }, [data, view.week]);

  if (error) return <p className="warn">Could not load backtest: {error}</p>;
  if (data === undefined) return <p className="muted">Loading…</p>;
  if (!data || !data.weeks.length) {
    return (
      <section className="backtest">
        <p>
          No graded weeks yet. After each week's games, the pipeline compares that week's pre-kickoff projections with
          the players' actual DraftKings points and the results appear here. A week is graded once every game on its
          slate is final and nflverse has published the stats, usually by Tuesday.
        </p>
      </section>
    );
  }
  const m = view.week === 'all' ? data.overall! : weeks[0].metrics;

  return (
    <section className="backtest">
      <div className="row-inputs">
        <label>
          Weeks{' '}
          <select value={view.week} onChange={(e) => setView({ ...view, week: e.target.value })}>
            <option value="all">All graded weeks ({data.weeks.length})</option>
            {data.weeks.map((w) => <option key={weekName(w)} value={weekName(w)}>{weekName(w)}{w.backfilled ? ' (backfilled)' : ''}</option>)}
          </select>
        </label>
        <span className="muted small">{m.n_graded} players graded (in the value pool at kickoff and recorded a stat)</span>
      </div>
      {data.weeks.length < 3 && (
        <p className="banner">
          {data.weeks.length} graded week{data.weeks.length > 1 ? 's' : ''} so far. One week is a small sample: wait for at least
          three before changing weights or settings on the strength of these numbers.
        </p>
      )}
      {weeks.some((w) => w.backfilled) && (
        <p className="muted small">
          Backfilled weeks ({weeks.filter((w) => w.backfilled).map((w) => `W${w.week}`).join(', ')}) were rebuilt after the games:
          injury news from that week isn't available, and each source's projections are what it serves for that week now.
          Treat them as less reliable than weeks saved live.
        </p>
      )}

      <h3>Projection accuracy</h3>
      <p className="muted small">
        Average miss in DraftKings points (lower is better); the small number is the bias (actual − projected, positive = projections too low).
        A source in bold beat the consensus on the same players. Hover a cell for details.
      </p>
      <ProjectionTable m={m} />

      <h3>Floor check</h3>
      <p className="muted small">The floor is a 20th-percentile estimate, so about 1 in 5 players should score below it.</p>
      <FloorTable m={m} />

      <h3>Value ranking</h3>
      <p className="muted small">
        How well each weight preset ordered players within a position, using your target total T = {settings.targetTotal}{' '}
        (salary pace = salary × {settings.targetTotal}/50,000). Higher is better; 0 means no better than random.
      </p>
      <ValueTable weeks={weeks} settings={settings} />

      <h3>Lineups</h3>
      <div className="row-inputs">
        <label title="Score a lineup needed to cash in a typical double-up">
          Cash line <input type="number" min={50} max={250} value={view.cashLine} onChange={(e) => setView({ ...view, cashLine: +e.target.value || 130 })} />
        </label>
        <span className="muted small">Best lineup per week with your optimizer rules (locks/excludes ignored). Click a row for the players.</span>
      </div>
      <Lineups weeks={weeks} options={options} cashLine={view.cashLine} />

      {m.dnp.length > 0 && (
        <>
          <h3>In the pool but did not play</h3>
          <p className="muted small">Players projected at kickoff who recorded no stats: late scratches or zero-touch games.</p>
          <ul className="small">
            {m.dnp.map((d) => (
              <li key={`${d.week}-${d.name}`}>
                {d.week ? `W${d.week} · ` : ''}{d.name} ({d.pos} {d.team}, {money(d.salary)}, proj {fixed(d.proj)}{d.status !== 'ACTIVE' ? `, ${d.status}` : ''})
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">Graded {new Date(data.generated_at).toLocaleString()} · results from nflverse open data. DST points allowed use the opponent's final score.</p>
    </section>
  );
}
