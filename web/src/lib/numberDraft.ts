/**
 * Number inputs that can be typed into on a phone: the text you type is a draft, and only a valid,
 * in-range number becomes the setting. Clamping every keystroke (the old behavior) turned "1" into
 * the minimum before "130" could be finished.
 */

/** While typing: the number to use now, or null to wait (empty, partial, invalid or out of range). */
export function liveValue(draft: string, min: number, max: number): number | null {
  const t = draft.trim();
  if (t === '' || !/^-?\d*\.?\d*$/.test(t) || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** On blur / Enter: clamp to the range, or keep the last good value if the draft isn't a number. */
export function finalValue(draft: string, min: number, max: number, fallback: number): number {
  const t = draft.trim();
  const n = Number(t);
  if (t === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
