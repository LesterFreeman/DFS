import { useEffect, useMemo, useState } from 'react';
import { Filters, applyFilters, DEFAULT_FILTERS, type FilterState } from './components/Filters';
import { PlayerDetail } from './components/PlayerDetail';
import { PlayerTable, sortPlayers, type Sort } from './components/PlayerTable';
import { RefreshButton } from './components/RefreshButton';
import { SourceBar } from './components/SourceBar';
import { ValueControls } from './components/ValueControls';
import { loadData, type AppData } from './lib/data';
import { ago } from './lib/format';
import { useStored } from './lib/storage';
import { computeValues, DEFAULT_SETTINGS, type ValueSettings } from './lib/value';

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useStored<ValueSettings>('dfs.settings', DEFAULT_SETTINGS);
  const [filters, setFilters] = useStored<FilterState>('dfs.filters', DEFAULT_FILTERS);
  const [sort, setSort] = useStored<Sort>('dfs.sort', { key: 'value', desc: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message));
  }, []);

  const valued = useMemo(() => (data ? computeValues(data.players, settings) : []), [data, settings]);
  const shown = useMemo(() => sortPlayers(applyFilters(valued, filters), sort), [valued, filters, sort]);
  const teams = useMemo(() => [...new Set(valued.map((p) => p.team))].sort(), [valued]);
  const selected = valued.find((p) => p.id === selectedId) ?? null;

  if (error) return <main className="app"><p className="warn">Could not load data: {error}</p></main>;
  if (!data) return <main className="app"><p className="muted">Loading…</p></main>;
  const { slate, sources } = data;

  return (
    <main className="app">
      <header className="top">
        <div>
          <h1>DFS Value Ranker</h1>
          <p className="muted">
            DK Classic · {slate.season} Week {slate.week} · {slate.games.length} games · updated {ago(sources.generated_at)}
          </p>
        </div>
        <RefreshButton />
      </header>
      {slate.sample && <p className="banner">Sample data: illustrative slate generated from test fixtures, not real salaries or projections.</p>}
      <SourceBar report={sources} />
      <ValueControls settings={settings} onChange={setSettings} />
      <Filters f={filters} onChange={setFilters} teams={teams} count={shown.length} />
      <PlayerTable players={shown} sort={sort} onSort={setSort} onSelect={(p) => setSelectedId(p.id)} />
      <footer className="muted small">
        Value = weighted z-scores within position. Byes: {slate.byes.join(', ') || 'none'}. Click a player for sources and components.
      </footer>
      {selected && <PlayerDetail p={selected} settings={settings} tz={slate.timezone} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
