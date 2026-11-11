import { catMap } from '../lib/analytics';
import { dayLabel } from '../lib/dates';
import { moneyCents } from '../lib/format';
import type { Insight } from '../lib/insights';
import { update } from '../lib/store';
import type { AppData, Transaction } from '../lib/types';
import { monthOf, today } from '../lib/dates';
import type { ReactNode } from 'react';
import { useNav } from '../nav';

/** A whole card that navigates when tapped. */
export function CardLink({ onClick, children, bare }: { onClick: () => void; children: ReactNode; bare?: boolean }) {
  return (
    <div
      className={bare ? undefined : 'card'}
      role="link"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {children}
    </div>
  );
}

export function TxRow({ data, t }: { data: AppData; t: Transaction }) {
  const nav = useNav();
  const c = catMap(data).get(t.categoryId);
  return (
    <button className="row" onClick={() => nav.open({ kind: 'tx', id: t.id })}>
      <span className="emoji" aria-hidden>
        {c?.icon ?? '📦'}
      </span>
      <span className="main">
        <div className="name">{t.merchant}</div>
        <div className="meta">
          {dayLabel(t.date)} · {c?.name ?? 'Everything else'}
        </div>
      </span>
      <span className={`amt ${t.amount > 0 ? 'in' : ''}`}>
        {t.amount > 0 ? '+' : ''}
        {moneyCents(Math.abs(t.amount))}
      </span>
    </button>
  );
}

const TONE_LABEL = { action: 'Act on this', watch: 'Worth a look', win: 'Going well' } as const;
const TONE_MARK = { action: '!', watch: '•', win: '✓' } as const;

export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  return (
    <div className="card insight">
      <span className="tag">
        <span className={`dot ${insight.tone}`} aria-hidden>
          {TONE_MARK[insight.tone]}
        </span>
        {TONE_LABEL[insight.tone]} · {insight.area}
      </span>
      <h3>{insight.title}</h3>
      <p>{insight.body}</p>
      {insight.figure && <span className="figure">{insight.figure}</span>}
      {!compact && insight.steps && (
        <ul>
          {insight.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {!compact && (
        <div className="foot">
          <button
            className="btn ghost small"
            onClick={() =>
              update((d) => {
                d.dismissed[insight.id] = monthOf(today());
              })
            }
          >
            Dismiss for this month
          </button>
        </div>
      )}
    </div>
  );
}
