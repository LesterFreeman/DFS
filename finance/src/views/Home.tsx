import { useMemo } from 'react';
import { LineChart, Meter } from '../components/charts';
import { Delta, Icon } from '../components/ui';
import { flow, netWorthSeries, pointAt, spendByCategory, txInMonth } from '../lib/analytics';
import { addDays, addMonths, dayLabel, daysBetween, monthLabel, monthOf, parseISO, today } from '../lib/dates';
import { money, moneyCompact, moneySigned, pctSigned } from '../lib/format';
import { goalStatus } from '../lib/goals';
import { generateInsights } from '../lib/insights';
import { lock, useData } from '../lib/store';
import { useNav } from '../nav';
import { CardLink, InsightCard, TxRow } from './shared';

export function Home() {
  const data = useData();
  const nav = useNav();
  const now = today();
  const month = monthOf(now);

  const series = useMemo(() => netWorthSeries(data, now), [data, now]);
  const current = series[series.length - 1];
  const yearSeries = series.filter((p) => p.date >= addDays(now, -366));
  const before = pointAt(series, addDays(now, -30)) ?? series[0];
  const change = current && before ? current.net - before.net : 0;

  const txs = txInMonth(data, month);
  const f = flow(data, txs);
  const cats = spendByCategory(data, txs).slice(0, 3);
  const day = now.slice(8);
  const lastMonth = addMonths(month, -1);
  const lastToDate = flow(data, txInMonth(data, lastMonth).filter((t) => t.date.slice(8) <= day)).spend;
  const budget = data.categories.reduce((s, c) => s + (c.budget ?? 0), 0);
  const budgetSpent = spendByCategory(data, txs)
    .filter((r) => r.category.budget)
    .reduce((s, r) => s + r.total, 0);

  const insights = useMemo(() => generateInsights(data, now), [data, now]);
  // The two most pressing, from different areas so the home screen is not one topic twice.
  const open = insights.filter((i) => i.tone !== 'win');
  const top = open.filter((i, n) => open.findIndex((o) => o.area === i.area) === n).slice(0, 2);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="stack">
      <header className="top">
        <div>
          <div className="sub">{parseISO(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>
            {greeting}
            {data.profile.name ? `, ${data.profile.name}` : ''}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => lock()} aria-label="Lock">
            {Icon.lock}
          </button>
          <button className="icon-btn" onClick={() => nav.open({ kind: 'settings' })} aria-label="Settings">
            {Icon.gear}
          </button>
        </div>
      </header>

      <CardLink onClick={() => nav.go('worth')}>
        <div className="label">Net worth</div>
        {current ? (
          <>
            <div className="hero">{money(current.net)}</div>
            {before && before !== current && (
              <Delta
                value={change}
                text={`${moneySigned(change)}${before.net ? ` (${pctSigned((change / Math.abs(before.net)) * 100)})` : ''}`}
                vs={` since ${dayLabel(before.date)}`}
              />
            )}
            {yearSeries.length > 2 && (
              <div style={{ marginTop: 10 }}>
                <LineChart bare height={84} label="Net worth over the last year" points={yearSeries.map((p) => ({ x: daysBetween(yearSeries[0].date, p.date), y: p.net }))} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hero">{money(0)}</div>
            <p className="muted small">Add your accounts to see what you own and owe.</p>
          </>
        )}
      </CardLink>

      <CardLink onClick={() => nav.go('spending')}>
        <div className="card-head">
          <h2>{monthLabel(month)}</h2>
          <span className="link">Spending</span>
        </div>
        <div className="label">Spent so far</div>
        <div className="hero sm">{money(f.spend)}</div>
        {lastToDate > 0 && (
          <Delta value={f.spend - lastToDate} goodWhenUp={false} text={moneySigned(f.spend - lastToDate)} vs={` vs this point in ${monthLabel(lastMonth, 'short')}`} />
        )}
        {budget > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="small muted">
              Budgeted categories: {money(budgetSpent)} of {money(budget)}
            </div>
            <Meter value={budgetSpent} max={budget} />
          </div>
        )}
        {cats.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
            {cats.map((r) => (
              <div key={r.category.id} style={{ display: 'flex', justifyContent: 'space-between' }} className="small">
                <span>
                  {r.category.icon} {r.category.name}
                </span>
                <b>{money(r.total)}</b>
              </div>
            ))}
          </div>
        )}
      </CardLink>

      <div className="stats">
        <div className="stat">
          <div className="label">Income</div>
          <div className="value">{moneyCompact(f.income)}</div>
        </div>
        <div className="stat">
          <div className="label">Spent</div>
          <div className="value">{moneyCompact(f.spend)}</div>
        </div>
        <div className="stat">
          <div className="label">Kept</div>
          <div className="value">{moneyCompact(f.net)}</div>
        </div>
      </div>

      {top.length > 0 && (
        <>
          <div className="section-title">
            <span>Recommended for you</span>
            <button className="link" onClick={() => nav.go('advice')}>
              See all {insights.length}
            </button>
          </div>
          {top.map((i) => (
            <CardLink key={i.id} bare onClick={() => nav.go('advice')}>
              <InsightCard insight={i} compact />
            </CardLink>
          ))}
        </>
      )}

      {data.goals.length > 0 && (
        <>
          <div className="section-title">
            <span>Goals</span>
            <button className="link" onClick={() => nav.go('plan')}>
              Plan
            </button>
          </div>
          <div className="card flush">
            {data.goals.map((g) => {
              const s = goalStatus(data, g, now);
              return (
                <button className="row" key={g.id} onClick={() => nav.open({ kind: 'goal', id: g.id })}>
                  <span className="emoji" aria-hidden>
                    {g.icon}
                  </span>
                  <span className="main">
                    <div className="name">{g.name}</div>
                    <Meter thin value={s.progress} max={1} tone={s.complete ? 'done' : 'plain'} />
                  </span>
                  <span className="amt">
                    {(s.progress * 100).toFixed(0)}%<div className="meta">{money(s.remaining)} to go</div>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="section-title">
        <span>Recent activity</span>
        <button className="link" onClick={() => nav.open({ kind: 'tx' })}>
          + Add
        </button>
      </div>
      <div className="card flush">
        {data.transactions.length ? (
          data.transactions.slice(0, 5).map((t) => <TxRow key={t.id} data={data} t={t} />)
        ) : (
          <div className="empty">
            <p>No transactions yet.</p>
            <button className="btn small secondary" onClick={() => nav.open({ kind: 'import' })}>
              Import from your bank
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
