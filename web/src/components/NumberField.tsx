import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { finalValue, liveValue } from '../lib/numberDraft';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shown (empty field) for this value, e.g. min salary 0 = "off". */
  emptyValue?: number;
};

/** A number input you can clear and retype: commits only valid in-range values, clamps on blur. */
export function NumberField({ value, onChange, min, max, step = 1, emptyValue, ...rest }: Props) {
  const shown = (v: number) => (emptyValue != null && v === emptyValue ? '' : String(v));
  const [draft, setDraft] = useState(shown(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(shown(value)); // follow outside changes (e.g. "Use 146 as target total T")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing]);

  const commit = () => {
    const v = draft.trim() === '' && emptyValue != null ? emptyValue : finalValue(draft, min, max, value);
    setEditing(false);
    setDraft(shown(v));
    if (v !== value) onChange(v);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
      pattern={Number.isInteger(step) ? '[0-9]*' : undefined}
      value={draft}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = liveValue(e.target.value, min, max);
        if (v != null && v !== value) onChange(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      aria-valuemin={min}
      aria-valuemax={max}
    />
  );
}
