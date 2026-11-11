import { createContext, useContext } from 'react';

export type Tab = 'home' | 'spending' | 'worth' | 'plan' | 'advice';

export type SheetState =
  | { kind: 'tx'; id?: string }
  | { kind: 'account'; id?: string }
  | { kind: 'goal'; id?: string }
  | { kind: 'category'; id: string; month: string }
  | { kind: 'import' }
  | { kind: 'settings' }
  | null;

export interface Nav {
  go: (tab: Tab) => void;
  open: (sheet: SheetState) => void;
  close: () => void;
}

export const NavContext = createContext<Nav>({ go: () => {}, open: () => {}, close: () => {} });
export const useNav = () => useContext(NavContext);
