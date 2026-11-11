import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './components/ui';
import { today } from './lib/dates';
import { generateInsights } from './lib/insights';
import { boot, lock, useStore } from './lib/store';
import { NavContext, type Nav, type SheetState, type Tab } from './nav';
import { Advice } from './views/Advice';
import { Lock, Welcome } from './views/Gate';
import { Home } from './views/Home';
import { NetWorth } from './views/NetWorth';
import { Plan } from './views/Plan';
import { SettingsSheet } from './views/Settings';
import { Spending } from './views/Spending';
import { AccountSheet, CategorySheet, GoalSheet, ImportSheet, TransactionSheet } from './views/sheets';

const TABS: [Tab, string, keyof typeof Icon][] = [
  ['home', 'Home', 'home'],
  ['spending', 'Spending', 'spend'],
  ['worth', 'Net worth', 'worth'],
  ['plan', 'Plan', 'plan'],
  ['advice', 'Advice', 'advice'],
];

/** Lock after this long in the background when a passcode is set. */
const AUTO_LOCK_MS = 3 * 60 * 1000;

export function App() {
  const { status, data, hasPasscode } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<SheetState>(null);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    if (!hasPasscode) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [hasPasscode]);

  useEffect(() => {
    if (status !== 'ready') setSheet(null);
  }, [status]);

  const go = useCallback((t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  const close = useCallback(() => setSheet(null), []);
  const nav = useMemo<Nav>(() => ({ go, open: setSheet, close }), [go, close]);
  const actions = useMemo(() => (data ? generateInsights(data, today()).filter((i) => i.tone === 'action').length : 0), [data]);

  if (status === 'loading') return null;
  if (status === 'new') return <Welcome />;
  if (status === 'locked' || !data) return <Lock />;

  return (
    <NavContext.Provider value={nav}>
      <main className="app">
        {tab === 'home' && <Home />}
        {tab === 'spending' && <Spending />}
        {tab === 'worth' && <NetWorth />}
        {tab === 'plan' && <Plan />}
        {tab === 'advice' && <Advice />}
      </main>
      <nav className="tabs" aria-label="Sections">
        <div>
          {TABS.map(([id, label, icon]) => (
            <button key={id} className="tab" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
              {Icon[icon]}
              {label}
              {id === 'advice' && actions > 0 && <span className="badge">{actions}</span>}
            </button>
          ))}
        </div>
      </nav>
      {sheet?.kind === 'tx' && <TransactionSheet key={sheet.id ?? 'new'} id={sheet.id} />}
      {sheet?.kind === 'account' && <AccountSheet key={sheet.id ?? 'new'} id={sheet.id} />}
      {sheet?.kind === 'goal' && <GoalSheet key={sheet.id ?? 'new'} id={sheet.id} />}
      {sheet?.kind === 'category' && <CategorySheet id={sheet.id} month={sheet.month} />}
      {sheet?.kind === 'import' && <ImportSheet />}
      {sheet?.kind === 'settings' && <SettingsSheet />}
    </NavContext.Provider>
  );
}
