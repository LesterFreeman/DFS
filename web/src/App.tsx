import { useEffect, useMemo, useState } from 'react';
import { Backtest } from './components/Backtest';
import { Glossary } from './components/Glossary';
import { Filters, applyFilters, DEFAULT_FILTERS, type FilterState } from './components/Filters';
import { PlayerDetail } from './components/PlayerDetail';
import { LockButtons, Optimizer, type LineupControls } from './components/Optimizer';
import { PlayerTable, sortPlayers, type Sort } from './components/PlayerTable';
import { RefreshButton } from './components/RefreshButton';
import { SourceBar } from './components/SourceBar';
import { ValueControls } from './components/ValueControls';
import { loadData, type AppData } from './lib/data';
import { ago } from './lib/format';
import { DEFAULT_OPTIONS, type OptimizerOptions } from './lib/optimizer';
import { useStored } from './lib/storage';
import { computeValues, DEFAULT_SETTINGS, type ValueSettings } from './lib/value';

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useStored<ValueSettings>('dfs.settings', DEFAULT_SETTINGS);
  const [filters, setFilters] = useStored<FilterState>('dfs.filters', DEFAULT_FILTERS);
  const [sort, setSort] = useStored<Sort>('dfs.sort', { key: 'value', desc: true });
  const [options, setOptions] = useStored<OptimizerOptions>('dfs.optimizer', DEFAULT_OPTIONS);
  const [tab, setTab] = useStored<{ tab: 'players' | 'lineups' | 'backtest' | 'glossary' }>('dfs.tab', { tab: 'players' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Locks/excludes belong to one slate; key them by draft group so last week's don't linger.
  const slateKey = data ? `dfs.lineup.${data.slate.draft_group_id ?? data.slate.slate_date}` : 'dfs.lineup.none';
  const [lineupState, setLineupState] = useStored<{ key: string; locks: string[]; excludes: string[] }>(
    'dfs.lineup', { key: '', locks: [], excludes: [] },
  );
  const current = useMemo(
    () => (lineupState.key === slateKey ? lineupState : { key: slateKey, locks: [] as string[], excludes: [] as string[] }),
    [lineupState, slateKey],
  );
  const ctl: LineupControls = {
    locks: current.locks,
    excludes: current.excludes,
    toggleLock: (id) =>
      setLineupState({
        key: slateKey,
        locks: current.locks.includes(id) ? current.locks.filter((x) => x !== id) : [...current.locks, id],
        excludes: current.excludes.filter((x) => x !== id),
      }),
    toggleExclude: (id) =>
      setLineupState({
        key: slateKey,
        locks: current.locks.filter((x) => x !== id),
        excludes: current.excludes.includes(id) ? current.excludes.filter((x) => x !== id) : [...current.excludes, id],
      }),
    clear: () => setLineupState({ key: slateKey, locks: [], excludes: [] }),
  };

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
            DK Classic{slate.slate_label ? ` ${slate.slate_label.replace(/[()]/g, '')}` : ''} · {slate.season} Week {slate.week} · {slate.games.length} games · updated {ago(sources.generated_at)}
          </p>
        </div>
        <RefreshButton />
      </header>
      {slate.sample && <p className="banner">Sample data: illustrative slate generated from test fixtures, not real salaries or projections.</p>}
      <SourceBar report={sources} />
      <ValueControls settings={settings} onChange={setSettings} />
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab.tab === 'players'} className={tab.tab === 'players' ? 'on' : ''} onClick={() => setTab({ tab: 'players' })}>
          Players
        </button>
        <button role="tab" aria-selected={tab.tab === 'lineups'} className={tab.tab === 'lineups' ? 'on' : ''} onClick={() => setTab({ tab: 'lineups' })}>
          Lineups{ctl.locks.length + ctl.excludes.length ? ` (${ctl.locks.length}🔒 ${ctl.excludes.length}✕)` : ''}
        </button>
        <button role="tab" aria-selected={tab.tab === 'backtest'} className={tab.tab === 'backtest' ? 'on' : ''} onClick={() => setTab({ tab: 'backtest' })}>
          Backtest
        </button>
        <button role="tab" aria-selected={tab.tab === 'glossary'} className={tab.tab === 'glossary' ? 'on' : ''} onClick={() => setTab({ tab: 'glossary' })}>
          Glossary
        </button>
      </nav>
      {tab.tab === 'players' ? (
        <>
          <Filters f={filters} onChange={setFilters} teams={teams} count={shown.length} />
          <PlayerTable
            players={shown}
            sort={sort}
            onSort={setSort}
            onSelect={(p) => setSelectedId(p.id)}
            actions={(p) => <LockButtons id={p.id} ctl={ctl} />}
            rowClass={(p) => (ctl.locks.includes(p.id) ? 'locked' : ctl.excludes.includes(p.id) ? 'excluded' : '')}
          />
        </>
      ) : tab.tab === 'glossary' ? (
        <Glossary slate={slate} />
      ) : tab.tab === 'backtest' ? (
        <Backtest settings={settings} options={options} />
      ) : (
        <Optimizer
          players={valued}
          options={options}
          onOptions={setOptions}
          ctl={ctl}
          onSelect={(p) => setSelectedId(p.id)}
          onUseTotal={(t) => setSettings({ ...settings, targetTotal: t })}
        />
      )}
      <footer className="muted small">
        Value = weighted z-scores within position. Byes: {slate.byes.join(', ') || 'none'}. Click a player for sources and components.
      </footer>
      {selected && <PlayerDetail p={selected} settings={settings} tz={slate.timezone} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
