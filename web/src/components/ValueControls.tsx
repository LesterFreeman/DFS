import { PRESETS, type ValueSettings, type Weights } from '../lib/value';
import { NumberField } from './NumberField';

const LABELS: Record<keyof Weights, [string, string]> = {
  efficiency: ['Efficiency', 'Projected points per $1K of salary'],
  positional: ['Positional', "Points above this slate's salary curve for the position"],
  budget: ['Budget impact', 'Points above the pace needed to reach the target lineup total'],
  reliability: ['Reliability', 'Source agreement + floor ratio (minus a penalty for Q)'],
};

export function ValueControls({ settings, onChange }: { settings: ValueSettings; onChange: (s: ValueSettings) => void }) {
  const w = settings.weights;
  const total = w.efficiency + w.positional + w.budget + w.reliability || 1;
  const activePreset = Object.entries(PRESETS).find(([, p]) =>
    (Object.keys(p) as (keyof Weights)[]).every((k) => Math.abs(p[k] - w[k]) < 1e-9),
  )?.[0];

  const setWeight = (k: keyof Weights, v: number) => onChange({ ...settings, weights: { ...w, [k]: v } });

  return (
    <details className="panel">
      <summary>
        Value weights <span className="muted">{activePreset ?? 'Custom'}</span>
      </summary>
      <div className="presets">
        {Object.entries(PRESETS).map(([name, p]) => (
          <button key={name} className={name === activePreset ? 'on' : ''} onClick={() => onChange({ ...settings, weights: p })}>
            {name}
          </button>
        ))}
      </div>
      <div className="sliders">
        {(Object.keys(LABELS) as (keyof Weights)[]).map((k) => (
          <label key={k} title={LABELS[k][1]}>
            <span>
              {LABELS[k][0]} <b>{Math.round((w[k] / total) * 100)}%</b>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={w[k]} onChange={(e) => setWeight(k, +e.target.value)} />
          </label>
        ))}
      </div>
      <div className="row-inputs">
        <label title="Projected total of a typical winning cash lineup; sets the pace used by Budget impact">
          Target lineup total (T)
          <NumberField min={80} max={250} value={settings.targetTotal} onChange={(v) => onChange({ ...settings, targetTotal: v })} />
        </label>
        <label title="Subtracted from the reliability z-score for Questionable players">
          Q penalty
          <NumberField min={0} max={3} step={0.25} value={settings.qPenalty} onChange={(v) => onChange({ ...settings, qPenalty: v })} />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.excludeQuestionable}
            onChange={(e) => onChange({ ...settings, excludeQuestionable: e.target.checked })}
          />
          Exclude Q players
        </label>
      </div>
    </details>
  );
}
