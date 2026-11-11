import { useEffect, useMemo, useState } from 'react';
import { LineChart, Meter } from '../components/charts';
import { Seg, Slider } from '../components/ui';
import { dayLabel, today } from '../lib/dates';
import { money, moneyCompact, moneySigned } from '../lib/format';
import { goalStatus } from '../lib/goals';
import { homeEquityNow, investableNow } from '../lib/insights';
import { END_AGE, project, toFutureMoney } from '../lib/projection';
import { update, useData } from '../lib/store';
import type { Plan as PlanSettings } from '../lib/types';
import { useNav } from '../nav';

const STYLES: [string, number, number][] = [
  ['Cautious', 5, 8],
  ['Balanced', 6.5, 11],
  ['Growth', 7.5, 15],
];

export function Plan() {
  const data = useData();
  const nav = useNav();
  const now = today();
  const [draft, setDraft] = useState<PlanSettings>(data.plan);
  const [dollars, setDollars] = useState<'today' | 'future'>('today');
  const [more, setMore] = useState(false);
  // Follow the saved plan when it changes elsewhere (e.g. a restored backup).
  useEffect(() => setDraft(data.plan), [data.plan]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.plan);
  const age = data.profile.age;
  const investable = investableNow(data);
  const home = homeEquityNow(data);
  const set = (patch: Partial<PlanSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const result = useMemo(() => project({ age, investable, homeEquity: draft.includeHome ? home : 0, plan: draft }), [age, investable, home, draft]);
  const saved = useMemo(
    () => (dirty ? project({ age, investable, homeEquity: data.plan.includeHome ? home : 0, plan: data.plan }) : null),
    [dirty, age, investable, home, data.plan],
  );

  const show = (v: number, atAge: number, inflation = draft.inflationPct) => (dollars === 'future' ? toFutureMoney(v, atAge - age, inflation) : v);
  const retired = age >= draft.retireAge;
  const at = result.atRetire;
  const chance = Math.round(result.success * 100);
  // Compare like with like: the saved plan's balance at this draft's retirement age.
  const savedAt = saved?.years.find((y) => y.age === at.age);
  const diff = savedAt ? at.p50 - savedAt.p50 : 0;
  // The best outcomes compound far beyond the rest late in life. Cap the axis so the middle path
  // stays readable; the wash runs off the top and the tooltip still gives the full range.
  const peak = Math.max(...result.years.map((y) => show(y.p50, y.age)), ...(saved?.years.map((y) => show(y.p50, y.age, data.plan.inflationPct)) ?? []));
  const yMax = Math.max(peak * 1.8, show(at.p90, at.age) * 1.15);

  return (
    <div className="stack">
      <header className="top">
        <div>
          <h1>Plan</h1>
          <div className="sub">Move the sliders and watch your future change</div>
        </div>
      </header>

      <div className="card">
        <div className="label">{retired ? 'Today' : `At ${draft.retireAge}, you could have about`}</div>
        <div className="hero">{moneyCompact(show(at.p50, at.age))}</div>
        <div className="small muted">
          Likely range {moneyCompact(show(at.p10, at.age))} to {moneyCompact(show(at.p90, at.age))}
          {dollars === 'today' ? ", in today's money" : ', in future money'}
        </div>
        {saved && savedAt && Math.abs(diff) >= 1 && (
          <div className="delta" style={{ marginTop: 6 }}>
            <span className={diff > 0 ? 'delta good' : 'delta bad'}>
              {diff > 0 ? '▲' : '▼'} {moneySigned(show(diff, at.age))}
            </span>
            <span className="vs"> vs your saved plan</span>
          </div>
        )}

        <div style={{ margin: '16px 0 4px' }}>
          <LineChart
            label="Projected balance by age"
            height={220}
            points={result.years.map((y) => ({ x: y.age, y: show(y.p50, y.age), lo: show(y.p10, y.age), hi: show(y.p90, y.age) }))}
            compare={saved?.years.map((y) => ({ x: y.age, y: show(y.p50, y.age, data.plan.inflationPct) }))}
            xTicks={[
              { x: age, label: `Age ${age}` },
              { x: Math.round((age + END_AGE) / 2), label: String(Math.round((age + END_AGE) / 2)) },
              { x: END_AGE, label: String(END_AGE) },
            ]}
            yFormat={moneyCompact}
            yMax={yMax}
            marker={retired ? undefined : { x: draft.retireAge, label: 'Retire' }}
            tip={(i) => {
              const y = result.years[i];
              return {
                title: `Age ${y.age}`,
                rows: [
                  ['Middle', moneyCompact(show(y.p50, y.age))],
                  ['Range', `${moneyCompact(show(y.p10, y.age))} to ${moneyCompact(show(y.p90, y.age))}`],
                ],
              };
            }}
          />
        </div>
        <div className="legend">
          <span>
            <i className="line" style={{ background: 'var(--accent)' }} />
            Middle outcome
          </span>
          <span>
            <i style={{ background: 'var(--accent)', opacity: 0.25 }} />8 in 10 outcomes
          </span>
          {saved && (
            <span>
              <i className="line" style={{ background: 'var(--s-other)' }} />
              Saved plan
            </span>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <Seg value={dollars} onChange={setDollars} options={[['today', "Today's money"], ['future', 'Future money']]} />
        </div>
      </div>

      <div className="stats two">
        <div className="stat">
          <div className="label">Money lasts to {END_AGE}</div>
          <div className="value">{chance}% of the time</div>
          <Meter thin value={result.success} max={1} tone={chance >= 85 ? 'done' : 'plain'} />
        </div>
        <div className="stat">
          <div className="label">Work is optional from</div>
          <div className="value">{result.fiNumber === 0 ? 'Covered' : result.fiAge !== null ? `Age ${result.fiAge}` : `After ${draft.retireAge}`}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            at {moneyCompact(result.fiNumber)} invested
          </div>
        </div>
      </div>
      {result.runsOutAge !== null && (
        <div className="banner">
          <span>
            In the middle outcome the money runs out around age <b>{result.runsOutAge}</b>. Try investing more, retiring later, or spending less in retirement.
          </span>
        </div>
      )}

      <div className="card stack">
        <Slider label="Invest each month" value={draft.monthlyInvest} display={money(draft.monthlyInvest)} min={0} max={5000} step={50} onChange={(v) => set({ monthlyInvest: v })} />
        <Slider label="Retire at" value={draft.retireAge} display={`Age ${draft.retireAge}`} min={Math.min(age + 1, 75)} max={75} step={1} onChange={(v) => set({ retireAge: v })} />
        <Slider label="Spend each month in retirement" value={draft.retireSpend} display={money(draft.retireSpend)} min={1000} max={15000} step={100} onChange={(v) => set({ retireSpend: v })} />
        <div>
          <Slider label="Expected yearly return" value={draft.returnPct} display={`${draft.returnPct}%`} min={2} max={11} step={0.25} onChange={(v) => set({ returnPct: v })} />
          <div className="chips">
            {STYLES.map(([name, r, v]) => (
              <button key={name} className="chip" aria-pressed={draft.returnPct === r && draft.volatilityPct === v} onClick={() => set({ returnPct: r, volatilityPct: v })}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <button className="link" style={{ textAlign: 'left' }} onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'Hide' : 'More'} assumptions
        </button>
        {more && (
          <>
            <Slider label="Other retirement income each month" value={draft.retireIncome} display={money(draft.retireIncome)} min={0} max={6000} step={100} onChange={(v) => set({ retireIncome: v })} />
            <Slider label="Inflation" value={draft.inflationPct} display={`${draft.inflationPct}%`} min={0} max={6} step={0.25} onChange={(v) => set({ inflationPct: v })} />
            <Slider label="Market ups and downs" value={draft.volatilityPct} display={`±${draft.volatilityPct}%`} min={0} max={25} step={1} onChange={(v) => set({ volatilityPct: v })} />
            <Slider label="Raise the monthly amount each year" value={draft.raisePct} display={`${draft.raisePct}% above inflation`} min={0} max={5} step={0.5} onChange={(v) => set({ raisePct: v })} />
            <Slider
              label="Your age"
              value={age}
              display={String(age)}
              min={18}
              max={80}
              step={1}
              onChange={(v) =>
                update((d) => {
                  d.profile.age = v;
                })
              }
            />
            <label className="switch-row">
              <span>
                Count home equity ({money(home)})<div className="small muted">Held steady in today's money and never spent</div>
              </span>
              <input type="checkbox" checked={draft.includeHome} onChange={(e) => set({ includeHome: e.target.checked })} />
            </label>
          </>
        )}

        {dirty && (
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setDraft(data.plan)}>
              Reset
            </button>
            <button
              className="btn"
              onClick={() =>
                update((d) => {
                  d.plan = draft;
                })
              }
            >
              Save as my plan
            </button>
          </div>
        )}
      </div>
      <p className="note">
        Starts from {money(investable)} you could invest today (cash, investments and retirement accounts, minus cards and loans). The range comes from 1,000 simulated futures with random yearly returns. It is a model for comparing choices, not a forecast.
      </p>

      <div className="section-title">
        <span>Goals</span>
        <button className="link" onClick={() => nav.open({ kind: 'goal' })}>
          + Add
        </button>
      </div>
      {data.goals.length === 0 ? (
        <div className="card empty">
          <div className="emoji-lg">🎯</div>
          <p>Name something you are saving for, or a debt you want gone, and Trove will track whether you are on pace.</p>
          <button className="btn secondary" onClick={() => nav.open({ kind: 'goal' })}>
            Add a goal
          </button>
        </div>
      ) : (
        data.goals.map((g) => {
          const s = goalStatus(data, g, now);
          return (
            <button className="card" key={g.id} onClick={() => nav.open({ kind: 'goal', id: g.id })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <strong>
                  {g.icon} {g.name}
                </strong>
                <span className="small muted">{s.complete ? 'Done' : s.onTrack === null ? '' : s.onTrack ? 'On track' : 'Behind'}</span>
              </div>
              <div className="big" style={{ marginTop: 6 }}>
                {money(s.done)} <span className="small muted">of {money(s.total)}</span>
              </div>
              <Meter value={s.progress} max={1} tone={s.complete ? 'done' : 'plain'} />
              <div className="small muted" style={{ marginTop: 8 }}>
                {s.complete
                  ? 'Reached'
                  : [
                      g.targetDate ? `By ${dayLabel(g.targetDate, true)}` : '',
                      s.needed !== null ? `needs ${money(s.needed)} a month` : '',
                      s.pace !== null ? `lately ${money(Math.max(0, s.pace))} a month` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || `${money(s.remaining)} to go`}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
