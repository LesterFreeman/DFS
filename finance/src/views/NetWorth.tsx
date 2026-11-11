import { useMemo, useState } from 'react';
import { LineChart, SegBar } from '../components/charts';
import { Delta, Icon } from '../components/ui';
import { allocation, netWorthSeries } from '../lib/analytics';
import { addDays, dayLabel, daysBetween, parseISO, today } from '../lib/dates';
import { money, moneyCompact, moneySigned, pctSigned } from '../lib/format';
import { useData } from '../lib/store';
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, isLiability, type AccountType, type AssetClass } from '../lib/types';
import { useNav } from '../nav';

const RANGES: [string, number][] = [
  ['3M', 92],
  ['6M', 183],
  ['1Y', 366],
  ['All', 100000],
];
const TYPE_ORDER: AccountType[] = ['cash', 'investment', 'retirement', 'property', 'other_asset', 'credit', 'loan', 'mortgage'];
export const CLASS_COLOR: Record<AssetClass, string> = {
  us_stocks: 'var(--s1)',
  intl_stocks: 'var(--s2)',
  bonds: 'var(--s3)',
  cash: 'var(--s4)',
  real_estate: 'var(--s5)',
  other: 'var(--s-other)',
};

export function NetWorth() {
  const data = useData();
  const nav = useNav();
  const now = today();
  const [range, setRange] = useState('1Y');
  const [view, setView] = useState<'net' | 'assets' | 'liabilities'>('net');

  const series = useMemo(() => netWorthSeries(data, now), [data, now]);
  const days = RANGES.find((r) => r[0] === range)![1];
  const shown = series.filter((p) => p.date >= addDays(now, -days));
  const current = series[series.length - 1];
  const first = shown[0];
  const change = current && first ? current[view] - first[view] : 0;
  const alloc = allocation(data.accounts);

  const xTicks = useMemo(() => {
    if (shown.length < 2) return [];
    const span = daysBetween(shown[0].date, now);
    const fmt = (d: string) => parseISO(d).toLocaleDateString(undefined, span > 400 ? { month: 'short', year: '2-digit' } : { month: 'short', day: span < 100 ? 'numeric' : undefined });
    const mid = shown[Math.floor(shown.length / 2)];
    return [
      { x: 0, label: fmt(shown[0].date) },
      { x: daysBetween(shown[0].date, mid.date), label: fmt(mid.date) },
      { x: span, label: 'Today' },
    ];
  }, [shown, now]);

  if (!data.accounts.length) {
    return (
      <div className="stack">
        <header className="top">
          <h1>Net worth</h1>
        </header>
        <div className="card empty">
          <div className="emoji-lg">🏦</div>
          <p>Add what you own and what you owe: bank accounts, investments, your home, cards and loans. Update the balances whenever you like and Trove keeps the history.</p>
          <button className="btn" onClick={() => nav.open({ kind: 'account' })}>
            Add your first account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="top">
        <h1>Net worth</h1>
        <button className="icon-btn" onClick={() => nav.open({ kind: 'account' })} aria-label="Add account">
          {Icon.plus}
        </button>
      </header>

      <div className="card">
        <div className="label">{view === 'net' ? 'Net worth' : view === 'assets' ? 'Assets' : 'Liabilities'}</div>
        <div className="hero">{money(current[view])}</div>
        {first && first !== current && (
          <Delta
            value={change}
            goodWhenUp={view !== 'liabilities'}
            text={`${moneySigned(change)}${first[view] ? ` (${pctSigned((change / Math.abs(first[view])) * 100)})` : ''}`}
            vs={` since ${dayLabel(first.date, days > 366)}`}
          />
        )}
        <div style={{ margin: '14px 0 10px' }}>
          {shown.length > 1 ? (
            <LineChart
              label={`${view} over time`}
              height={210}
              points={shown.map((p) => ({ x: daysBetween(shown[0].date, p.date), y: p[view] }))}
              xTicks={xTicks}
              yFormat={moneyCompact}
              tip={(i) => ({ title: dayLabel(shown[i].date, true), rows: [['', money(shown[i][view])]] })}
            />
          ) : (
            <p className="muted small" style={{ padding: '18px 0' }}>
              Your history starts today. Each time you update a balance, Trove records a point and the chart grows from here.
            </p>
          )}
        </div>
        <div className="chips" style={{ justifyContent: 'space-between' }}>
          <div className="chips">
            {RANGES.map(([r]) => (
              <button key={r} className="chip" aria-pressed={r === range} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stats two">
        <button className="stat" style={{ textAlign: 'left', outline: view === 'assets' ? '2px solid var(--accent)' : undefined }} onClick={() => setView(view === 'assets' ? 'net' : 'assets')}>
          <div className="label">Assets</div>
          <div className="value">{money(current.assets)}</div>
        </button>
        <button className="stat" style={{ textAlign: 'left', outline: view === 'liabilities' ? '2px solid var(--accent)' : undefined }} onClick={() => setView(view === 'liabilities' ? 'net' : 'liabilities')}>
          <div className="label">Liabilities</div>
          <div className="value">{money(current.liabilities)}</div>
        </button>
      </div>

      {alloc.total > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Investment mix</h2>
            <span className="muted small">{money(alloc.total)}</span>
          </div>
          <SegBar format={moneyCompact} parts={alloc.slices.map((s) => ({ key: s.cls, name: ASSET_CLASS_LABEL[s.cls], value: s.value, color: CLASS_COLOR[s.cls], darkText: s.cls === 'cash' }))} />
        </div>
      )}

      <div className="section-title">
        <span>Accounts</span>
        <button className="link" onClick={() => nav.open({ kind: 'account' })}>
          + Add
        </button>
      </div>
      <div className="card flush">
        {TYPE_ORDER.map((type) => {
          const list = data.accounts.filter((a) => a.type === type);
          if (!list.length) return null;
          const sum = list.reduce((s, a) => s + a.balance, 0);
          const sign = isLiability(type) ? -1 : 1;
          return (
            <div key={type}>
              <div className="group-head">
                <span>{ACCOUNT_TYPE_LABEL[type]}</span>
                <span>{money(sum * sign)}</span>
              </div>
              {list.map((a) => {
                const age = daysBetween(a.updatedAt, now);
                return (
                  <button className="row" key={a.id} onClick={() => nav.open({ kind: 'account', id: a.id })}>
                    <span className="main">
                      <div className="name">{a.name}</div>
                      <div className="meta">
                        {[a.institution, a.rate !== undefined ? `${a.rate}%` : '', age === 0 ? 'Updated today' : `Updated ${dayLabel(a.updatedAt)}`].filter(Boolean).join(' · ')}
                      </div>
                    </span>
                    <span className="amt">{money(a.balance * sign)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="note">Tap an account to update its balance. Every update adds a point to your history.</p>
    </div>
  );
}
