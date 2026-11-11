let currency = 'USD';
export function setCurrency(c: string) {
  currency = c || 'USD';
}

function fmt(n: number, opts: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }).format(n);
  } catch {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', ...opts }).format(n);
  }
}

/** $1,284 */
export function money(n: number): string {
  return fmt(Math.round(n) || 0, { maximumFractionDigits: 0 });
}

/** $1,284.50 */
export function moneyCents(n: number): string {
  return fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** $12.9K, $4.2M. Plain under 10,000. */
export function moneyCompact(n: number): string {
  if (Math.abs(n) < 10000) return money(n);
  return fmt(n, { notation: 'compact', maximumFractionDigits: Math.abs(n) >= 1e6 ? 2 : 1 });
}

/** +$1,284 or -$1,284 */
export function moneySigned(n: number): string {
  const r = Math.round(n);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + money(Math.abs(r));
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

export function pctSigned(n: number, digits = 1): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(digits) + '%';
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
