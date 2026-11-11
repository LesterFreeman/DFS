import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

export interface LinePoint {
  x: number;
  y: number;
  /** Optional range drawn as a wash around the line. */
  lo?: number;
  hi?: number;
}

export interface Tip {
  title: string;
  rows: [string, string][];
}

interface LineChartProps {
  points: LinePoint[];
  /** A quieter comparison line (same x values). */
  compare?: { x: number; y: number }[];
  height?: number;
  xTicks?: { x: number; label: string }[];
  yFormat?: (v: number) => string;
  tip?: (index: number) => Tip;
  /** Vertical marker with a label, e.g. the retirement age. */
  marker?: { x: number; label: string };
  /** No axes or labels: a sparkline. */
  bare?: boolean;
  area?: boolean;
  /** Cap the y axis here; anything above runs off the top. */
  yMax?: number;
  label: string;
}

export function LineChart({ points, compare, height = 200, xTicks = [], yFormat = String, tip, marker, bare, area = true, yMax, label }: LineChartProps) {
  const clipId = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = bare ? { l: 2, r: 6, t: 6, b: 4 } : { l: 46, r: 8, t: 18, b: 22 };
  const w = Math.max(10, width - m.l - m.r);
  const h = height - m.t - m.b;

  let content: ReactNode = null;
  let tipNode: ReactNode = null;
  if (width > 0 && points.length > 1) {
    const xs = points.map((p) => p.x);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const all = points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]).concat(compare?.map((p) => p.y) ?? []);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (yMax !== undefined && hi > yMax) hi = yMax;
    const ticks = bare ? [] : niceTicks(lo, hi, 3);
    if (ticks.length) {
      lo = Math.min(lo, ticks[0]);
      if (yMax === undefined) hi = Math.max(hi, ticks[ticks.length - 1]);
    } else {
      const pad = (hi - lo) * 0.08 || 1;
      lo -= pad;
      hi += pad;
    }
    const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * w;
    const sy = (y: number) => m.t + (1 - (y - lo) / (hi - lo || 1)) * h;
    const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    const hasBand = points.some((p) => p.lo !== undefined);
    const band = hasBand
      ? path(points.map((p) => ({ x: p.x, y: p.hi ?? p.y }))) +
        points
          .slice()
          .reverse()
          .map((p) => `L${sx(p.x).toFixed(1)},${sy(p.lo ?? p.y).toFixed(1)}`)
          .join('') +
        'Z'
      : '';
    const last = points[points.length - 1];
    const hp = hover !== null ? points[hover] : null;

    content = (
      <>
        <clipPath id={clipId}>
          <rect x={0} y={m.t - 6} width={width} height={h + 6} />
        </clipPath>
        {ticks.filter((t) => t <= hi).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + w} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t.x)} y={height - 5} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {t.label}
          </text>
        ))}
        {marker && marker.x > x0 && marker.x < x1 && (
          <g>
            <line x1={sx(marker.x)} x2={sx(marker.x)} y1={m.t - 4} y2={m.t + h} stroke="var(--axis)" strokeWidth={1} />
            <text x={sx(marker.x) + 5} y={m.t + 6} textAnchor="start">
              {marker.label}
            </text>
          </g>
        )}
        {hasBand && <path d={band} fill="var(--accent)" opacity={0.14} clipPath={`url(#${clipId})`} />}
        {area && !hasBand && (
          <path d={`${path(points)}L${sx(x1).toFixed(1)},${m.t + h}L${sx(x0).toFixed(1)},${m.t + h}Z`} fill="var(--accent)" opacity={0.1} />
        )}
        {compare && compare.length > 1 && <path d={path(compare)} fill="none" stroke="var(--s-other)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        <path d={path(points)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {!hp && !hasBand && <circle cx={sx(last.x)} cy={sy(last.y)} r={4.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />}
        {hp && (
          <g>
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={m.t} y2={m.t + h} stroke="var(--axis)" strokeWidth={1} />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r={5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </>
    );

    if (hp && tip && hover !== null) {
      const t = tip(hover);
      const left = Math.min(Math.max(sx(hp.x), 70), width - 70);
      tipNode = (
        <div className="tip" style={{ left, top: m.t - 2, transform: 'translate(-50%, -100%)' }}>
          <div className="t">{t.title}</div>
          {t.rows.map(([k, v]) => (
            <div key={k}>
              {k ? `${k} ` : ''}
              <b>{v}</b>
            </div>
          ))}
        </div>
      );
    }
  }

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!tip || points.length < 2 || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - m.l) / w));
    const x = points[0].x + frac * (points[points.length - 1].x - points[0].x);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    setHover(best);
  };

  return (
    <div className="chart" ref={ref} style={{ height }} onPointerDown={onMove} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {content}
      </svg>
      {tipNode}
    </div>
  );
}

interface ColumnsProps {
  items: { key: string; label: string; value: number }[];
  selected?: string;
  onSelect?: (key: string) => void;
  format: (v: number) => string;
  height?: number;
  /** Horizontal reference line, e.g. a budget. */
  target?: number;
  label: string;
}

/** One bar per period. The selected period is drawn in the accent, the rest step back. */
export function Columns({ items, selected, onSelect, format, height = 150, target, label }: ColumnsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = { t: 22, b: 22 };
  const h = height - m.t - m.b;
  const max = Math.max(1, target ?? 0, ...items.map((i) => i.value));
  const slot = width / Math.max(1, items.length);
  const bw = Math.min(24, slot * 0.6);
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label}>
        <line x1={0} x2={width} y1={m.t + h} y2={m.t + h} stroke="var(--axis)" strokeWidth={1} />
        {target !== undefined && target > 0 && <line x1={0} x2={width} y1={m.t + h - (target / max) * h} y2={m.t + h - (target / max) * h} stroke="var(--axis)" strokeWidth={1} />}
        {width > 0 &&
          items.map((it, i) => {
            const bh = Math.max(it.value > 0 ? 2 : 0, (Math.max(0, it.value) / max) * h);
            const x = i * slot + (slot - bw) / 2;
            const y = m.t + h - bh;
            const r = Math.min(4, bh);
            const on = it.key === selected;
            return (
              <g key={it.key} onClick={() => onSelect?.(it.key)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
                <path
                  d={`M${x},${y + bh}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + bh}Z`}
                  fill={on || !selected ? 'var(--accent)' : 'var(--quiet)'}
                />
                {on && (
                  <text className="cap" x={Math.min(Math.max(x + bw / 2, 26), width - 26)} y={y - 6} textAnchor="middle">
                    {format(it.value)}
                  </text>
                )}
                <text x={i * slot + slot / 2} y={height - 5} textAnchor="middle" style={on ? { fill: 'var(--ink)', fontWeight: 650 } : undefined}>
                  {it.label}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}

interface SegBarProps {
  parts: { key: string; name: string; value: number; color: string; darkText?: boolean }[];
  format: (v: number) => string;
}

/** One whole split into parts, with the share printed inside when it fits and a legend below. */
export function SegBar({ parts, format }: SegBarProps) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="segbar" role="img" aria-label={parts.map((p) => `${p.name} ${((p.value / total) * 100).toFixed(0)}%`).join(', ')}>
        {parts.map((p) => {
          const share = (p.value / total) * 100;
          return (
            <div key={p.key} title={`${p.name}: ${format(p.value)} (${share.toFixed(0)}%)`} style={{ flex: `${p.value} 0 0`, background: p.color, color: p.darkText ? '#0b0b0b' : '#fff' }}>
              {share >= 11 ? `${share.toFixed(0)}%` : ''}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} />
            {p.name} · {format(p.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Meter({ value, max, tone = 'auto', thin }: { value: number; max: number; tone?: 'auto' | 'plain' | 'done'; thin?: boolean }) {
  const frac = max > 0 ? value / max : 0;
  const cls = tone === 'auto' ? (frac > 1 ? 'over' : frac > 0.85 ? 'warn' : '') : tone;
  return (
    <div className={`meter ${cls} ${thin ? 'thin' : ''}`}>
      <i style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }} />
    </div>
  );
}
