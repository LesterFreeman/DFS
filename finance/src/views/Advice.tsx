import { useMemo, useState } from 'react';
import { monthOf, today } from '../lib/dates';
import { generateInsights, type Tone } from '../lib/insights';
import { update, useData } from '../lib/store';
import { InsightCard } from './shared';

const SECTIONS: [Tone, string][] = [
  ['action', 'Act on these'],
  ['watch', 'Worth a look'],
  ['win', 'Going well'],
];

export function Advice() {
  const data = useData();
  const now = today();
  const insights = useMemo(() => generateInsights(data, now), [data, now]);
  const [filter, setFilter] = useState<Tone | 'all'>('all');
  const count = (t: Tone) => insights.filter((i) => i.tone === t).length;
  const hidden = Object.values(data.dismissed).filter((m) => m === monthOf(now)).length;

  return (
    <div className="stack">
      <header className="top">
        <div>
          <h1>Advice</h1>
          <div className="sub">Worked out on this device from your own numbers</div>
        </div>
      </header>

      <div className="chips">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All {insights.length}
        </button>
        {SECTIONS.map(([tone, label]) =>
          count(tone) ? (
            <button key={tone} className="chip" aria-pressed={filter === tone} onClick={() => setFilter(tone)}>
              {label.replace(' these', '')} {count(tone)}
            </button>
          ) : null,
        )}
      </div>

      {SECTIONS.filter(([tone]) => filter === 'all' || filter === tone).map(([tone, label]) => {
        const list = insights.filter((i) => i.tone === tone);
        if (!list.length) return null;
        return (
          <div className="stack" key={tone}>
            <div className="section-title">
              <span>{label}</span>
            </div>
            {list.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        );
      })}

      {insights.length === 0 && (
        <div className="card empty">
          <div className="emoji-lg">🌤️</div>
          <p>Nothing to flag right now.</p>
        </div>
      )}

      {hidden > 0 && (
        <div className="banner">
          <span>{hidden} dismissed this month</span>
          <button
            className="link"
            onClick={() =>
              update((d) => {
                d.dismissed = {};
              })
            }
          >
            Bring back
          </button>
        </div>
      )}
      <p className="note">
        These are rules of thumb applied to the numbers you entered, not professional financial advice. They do not know your taxes, your job security or your plans, so treat them as prompts to think with.
      </p>
    </div>
  );
}
