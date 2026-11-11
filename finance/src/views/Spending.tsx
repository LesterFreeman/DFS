import { useMemo, useState } from 'react';
import { Columns, Meter } from '../components/charts';
import { Delta, Icon } from '../components/ui';
import { flow, monthlyFlows, spendByCategory, txInMonth } from '../lib/analytics';
import { addMonths, monthLabel, monthOf, today } from '../lib/dates';
import { money, moneyCompact, moneySigned } from '../lib/format';
import { useData } from '../lib/store';
import { useNav } from '../nav';
import { TxRow } from './shared';

export function Spending() {
  const data = useData();
  const nav = useNav();
  const now = today();
  const thisMonth = monthOf(now);
  const [month, setMonth] = useState(thisMonth);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');

  const txs = useMemo(() => txInMonth(data, month), [data, month]);
  const f = flow(data, txs);
  const rows = spendByCategory(data, txs);
  // Six months of columns, keeping the selected month in view.
  const windowEnd = addMonths(month, 2) > thisMonth ? thisMonth : addMonths(month, 2);
  const history = useMemo(() => monthlyFlows(data, windowEnd, 6), [data, windowEnd]);
  const prev = addMonths(month, -1);
  const isCurrent = month === thisMonth;
  const day = now.slice(8);
  const prevSpend = flow(data, txInMonth(data, prev).filter((t) => !isCurrent || t.date.slice(8) <= day)).spend;
  const max = Math.max(1, ...rows.map((r) => r.total));

  // Budgeted categories with nothing spent yet still belong in the list.
  const unspent = data.categories.filter((c) => c.budget && !rows.some((r) => r.category.id === c.id));
  const q = query.trim().toLowerCase();
  const shown = q ? txs.filter((t) => t.merchant.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q)) : txs;
  const list = showAll || q ? shown : shown.slice(0, 8);

  return (
    <div className="stack">
      <header className="top">
        <h1>Spending</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small secondary" onClick={() => nav.open({ kind: 'import' })}>
            Import
          </button>
          <button className="icon-btn" onClick={() => nav.open({ kind: 'tx' })} aria-label="Add transaction">
            {Icon.plus}
          </button>
        </div>
      </header>

      <div className="card">
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(prev)} aria-label="Previous month">
            {Icon.left}
          </button>
          <strong>{monthLabel(month)}</strong>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={isCurrent} style={{ opacity: isCurrent ? 0.3 : 1 }} aria-label="Next month">
            {Icon.right}
          </button>
        </div>
        <div style={{ textAlign: 'center', margin: '14px 0 4px' }}>
          <div className="label">{isCurrent ? 'Spent so far' : 'Spent'}</div>
          <div className="hero">{money(f.spend)}</div>
          {prevSpend > 0 && (
            <Delta
              value={f.spend - prevSpend}
              goodWhenUp={false}
              text={moneySigned(f.spend - prevSpend)}
              vs={isCurrent ? ` vs this point in ${monthLabel(prev, 'short')}` : ` vs ${monthLabel(prev, 'short')}`}
            />
          )}
        </div>
        <Columns
          label="Spending by month"
          items={history.map((h) => ({ key: h.month, label: monthLabel(h.month, 'short'), value: h.flow.spend }))}
          selected={month}
          onSelect={setMonth}
          format={moneyCompact}
        />
      </div>

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
          <div className="value">{f.income > 0 ? `${Math.round((f.net / f.income) * 100)}%` : moneyCompact(f.net)}</div>
        </div>
      </div>

      <div className="section-title">
        <span>By category</span>
      </div>
      <div className="card flush">
        {rows.length === 0 && unspent.length === 0 && (
          <div className="empty">
            <p>Nothing spent in {monthLabel(month)}.</p>
          </div>
        )}
        {rows.map((r) => {
          const budget = r.category.budget;
          return (
            <button className="row" key={r.category.id} onClick={() => nav.open({ kind: 'category', id: r.category.id, month })}>
              <span className="emoji" aria-hidden>
                {r.category.icon}
              </span>
              <span className="main">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="name">{r.category.name}</span>
                  <span className="amt">{money(r.total)}</span>
                </div>
                {budget ? <Meter value={r.total} max={budget} /> : <Meter value={r.total} max={max} tone="plain" />}
                <div className="meta" style={{ marginTop: 4 }}>
                  {budget
                    ? r.total > budget
                      ? `${money(r.total - budget)} over ${money(budget)} budget`
                      : `${money(budget - r.total)} left of ${money(budget)}`
                    : `${((r.total / (f.spend || 1)) * 100).toFixed(0)}% of spending · ${r.count} transaction${r.count === 1 ? '' : 's'}`}
                </div>
              </span>
            </button>
          );
        })}
        {unspent.map((c) => (
          <button className="row" key={c.id} onClick={() => nav.open({ kind: 'category', id: c.id, month })}>
            <span className="emoji" aria-hidden>
              {c.icon}
            </span>
            <span className="main">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="name">{c.name}</span>
                <span className="amt">{money(0)}</span>
              </div>
              <Meter value={0} max={c.budget!} />
              <div className="meta" style={{ marginTop: 4 }}>
                {money(c.budget!)} left of {money(c.budget!)}
              </div>
            </span>
          </button>
        ))}
      </div>
      <p className="note">Tap a category to see its transactions, its trend, and to set a budget.</p>

      <div className="section-title">
        <span>Transactions</span>
        <span className="muted small">{txs.length}</span>
      </div>
      {txs.length > 8 && <input className="input" type="search" placeholder="Search this month" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <div className="card flush">
        {list.length ? (
          list.map((t) => <TxRow key={t.id} data={data} t={t} />)
        ) : (
          <div className="empty">
            <p>{q ? 'No matches.' : 'No transactions this month.'}</p>
            {!q && (
              <button className="btn small secondary" onClick={() => nav.open({ kind: 'import' })}>
                Import a CSV
              </button>
            )}
          </div>
        )}
        {!showAll && !q && shown.length > 8 && (
          <button className="row" onClick={() => setShowAll(true)} style={{ justifyContent: 'center' }}>
            <span className="link">Show all {shown.length}</span>
          </button>
        )}
      </div>
    </div>
  );
}
