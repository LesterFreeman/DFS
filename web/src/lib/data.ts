import type { Player, Slate, SourcesReport } from '../types';

export interface AppData {
  players: Player[];
  slate: Slate;
  sources: SourcesReport;
}

async function getJson<T>(name: string, bust: string): Promise<T> {
  const res = await fetch(`./data/${name}?t=${bust}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadData(): Promise<AppData> {
  const bust = String(Date.now());
  const [players, slate, sources] = await Promise.all([
    getJson<Player[]>('players.json', bust),
    getJson<Slate>('slate.json', bust),
    getJson<SourcesReport>('sources.json', bust),
  ]);
  return { players, slate, sources };
}
