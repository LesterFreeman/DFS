import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './components/ui';
import { today } from './lib/dates';
import { generateInsights } from './lib/insights';
import { boot, lock, useStore } from './lib/store';
import { NavContext, type Nav, type SheetState, type Tab } from './nav';
import { Advice } from './views/Advice';
import { CreatePasscode, Lock, Welcome } from './views/Gate';
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

export function App() {
  const { status, data } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<SheetState>(null);

  useEffect(() => {
    boot();
  }, []);

  // Lock after a spell in the background, and blank the screen while away so the app switcher
  // does not show balances. (Locking instantly would break the file picker, which also hides the page.)
  const autoLockMs = (data?.profile.autoLockMin ?? 1) * 60_000;
  useEffect(() => {
    if (status !== 'ready') return;
    let hiddenAt = 0;
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      document.body.classList.toggle('away', hidden);
      if (hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= autoLockMs) lock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.body.classList.remove('away');
    };
  }, [status, autoLockMs]);

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
  if (status === 'unprotected') return <CreatePasscode />;
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
