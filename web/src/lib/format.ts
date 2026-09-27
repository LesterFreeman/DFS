export const money = (n: number) => `$${n.toLocaleString('en-US')}`;

export const fixed = (n: number | null | undefined, d = 1) => (n == null || Number.isNaN(n) ? '–' : n.toFixed(d));

export const signed = (n: number | null | undefined, d = 2) =>
  n == null ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function kickoff(iso: string | null, tz = 'America/New_York'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });
}

export const SOURCE_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  cbs: 'CBS',
  vegas_dst: 'Vegas model',
  draftsharks: 'DraftSharks',
  rotoballer: 'RotoBaller',
  fantasyknockout: 'Fantasy Knockout',
  yahoo: 'Yahoo',
  pff: 'PFF',
  bettingpros: 'BettingPros',
  fantasysixpack: 'Fantasy Six Pack',
  fantasypoints: 'Fantasy Points',
  nflcom: 'NFL.com',
  fantasypros: 'FantasyPros (upload)',
};

export const STATUS_LABELS: Record<string, string> = { ACTIVE: '', Q: 'Q', D: 'D', O: 'OUT', IR: 'IR' };
