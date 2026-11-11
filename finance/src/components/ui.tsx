import { useEffect, useState, type ReactNode } from 'react';

export const Icon = {
  home: <svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" /></svg>,
  spend: <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></svg>,
  worth: <svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" /></svg>,
  plan: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>,
  advice: <svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" /></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.400-2.300 1a7 7 0 0 0-2.300-1.300L14 3h-4l-.3 2.500a7 7 0 0 0-2.300 1.300l-2.300-1-2 3.400 2 1.500a7 7 0 0 0 0 2.600l-2 1.500 2 3.400 2.300-1a7 7 0 0 0 2.300 1.300L10 21h4l.3-2.500a7 7 0 0 0 2.300-1.300l2.300 1 2-3.400-2-1.500c.1-.4.1-.9.1-1.300z" /></svg>,
  lock: <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  left: <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>,
  right: <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>,
};

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            {Icon.close}
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** A number field that tolerates "$1,200" and empty input while typing. */
export function NumberInput({ value, onChange, placeholder, autoFocus }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="input"
      inputMode="decimal"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
    />
  );
}
function parse(s: string): number | undefined {
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, display, min, max, step, onChange }: { label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <div className="head">
        <span>{label}</span>
        <strong>{display}</strong>
      </div>
      <input type="range" min={min} max={Math.max(max, value)} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Delta({ value, text, goodWhenUp = true, vs }: { value: number; text: string; goodWhenUp?: boolean; vs?: string }) {
  const up = value > 0;
  const flat = Math.abs(value) < 0.005;
  const good = flat ? null : up === goodWhenUp;
  return (
    <span className={`delta ${good === null ? '' : good ? 'good' : 'bad'}`}>
      {flat ? '→' : up ? '▲' : '▼'} {text}
      {vs && <span className="vs">{vs}</span>}
    </span>
  );
}

/** Save text as a file. Uses the share sheet on phones where plain downloads are unreliable. */
export async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
