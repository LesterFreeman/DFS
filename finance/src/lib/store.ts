import { useSyncExternalStore } from 'react';
import { makeSnapshot } from './analytics';
import { DEFAULT_CATEGORIES, guessCategory } from './categories';
import { deriveKey, openWithPasscode, seal, type Key, type Sealed } from './crypto';
import { today } from './dates';
import { DEFAULT_PLAN, emptyData } from './demo';
import { clearFailures, recordFailure, waitRemaining } from './lockout';
import { setCurrency, uid } from './format';
import type { Account, AppData, Transaction } from './types';

// All data lives in this browser's IndexedDB under one record. With a passcode set the record is
// AES-256-GCM ciphertext and the key exists only in memory while the app is unlocked.

type Stored = { enc: false; data: AppData } | Sealed;

const DB = 'trove';
const STORE = 'kv';
const KEY = 'data';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readStored(): Promise<Stored | undefined> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as Stored | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const raw = localStorage.getItem(DB);
    return raw ? (JSON.parse(raw) as Stored) : undefined;
  }
}

async function writeStored(value: Stored | undefined): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      if (value === undefined) t.objectStore(STORE).delete(KEY);
      else t.objectStore(STORE).put(value, KEY);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    if (value === undefined) localStorage.removeItem(DB);
    else localStorage.setItem(DB, JSON.stringify(value));
  }
}

/** 'unprotected' means data exists without a passcode (older versions allowed that); one must be set before it is shown. */
export type Status = 'loading' | 'new' | 'locked' | 'unprotected' | 'ready';

interface State {
  status: Status;
  data: AppData | null;
  hasPasscode: boolean;
}

let state: State = { status: 'loading', data: null, hasPasscode: false };
let key: Key | null = null;
let sealedAtRest: Sealed | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (state.data) setCurrency(state.data.profile.currency);
  listeners.forEach((l) => l());
}

/** Fill in anything a backup from an older version might be missing. */
export function normalize(raw: Partial<AppData>): AppData {
  const base = emptyData();
  const cats = raw.categories?.length ? raw.categories : base.categories;
  for (const c of DEFAULT_CATEGORIES) if (!cats.some((x) => x.id === c.id) && (c.id === 'other' || c.id === 'transfer')) cats.push({ ...c });
  return {
    ...base,
    ...raw,
    version: 1,
    profile: { ...base.profile, ...raw.profile },
    plan: { ...DEFAULT_PLAN, ...raw.plan },
    categories: cats,
    accounts: raw.accounts ?? [],
    snapshots: raw.snapshots ?? [],
    transactions: raw.transactions ?? [],
    goals: raw.goals ?? [],
    merchantRules: raw.merchantRules ?? {},
    dismissed: raw.dismissed ?? {},
  };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

async function persist() {
  const data = state.data;
  // Nothing is ever written without a passcode key: data at rest is always ciphertext.
  if (!data || !key) return;
  const record = await seal(data, key);
  sealedAtRest = record;
  await writeStored(record);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(persist).catch((e) => console.error('Save failed', e));
  }, 250);
}

export function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(persist).catch((e) => console.error('Save failed', e));
  return saving;
}

export async function boot() {
  const stored = await readStored();
  if (!stored) return set({ status: 'new' });
  if (stored.enc) {
    sealedAtRest = stored;
    return set({ status: 'locked', hasPasscode: true });
  }
  set({ status: 'unprotected', data: normalize(stored.data), hasPasscode: false });
}

export type UnlockResult = 'ok' | 'wrong' | 'wait';

export async function unlock(passcode: string): Promise<UnlockResult> {
  if (!sealedAtRest) return 'wrong';
  if (waitRemaining() > 0) return 'wait';
  try {
    const res = await openWithPasscode<AppData>(sealedAtRest, passcode);
    key = res.key;
    clearFailures();
    set({ status: 'ready', data: normalize(res.value), hasPasscode: true });
    navigator.storage?.persist?.().catch(() => {});
    return 'ok';
  } catch {
    recordFailure();
    return 'wrong';
  }
}

export async function lock() {
  if (!key) return;
  await flushSave();
  key = null;
  set({ status: 'locked', data: null });
}

/** First run: store this data under a new passcode. */
export async function start(data: AppData, passcode: string) {
  key = await deriveKey(passcode);
  set({ status: 'ready', data, hasPasscode: true });
  await flushSave();
  // Ask the browser not to evict this origin's storage under disk pressure.
  navigator.storage?.persist?.().catch(() => {});
}

/** Set or change the passcode. The stored data is re-encrypted under the new key straight away. */
export async function setPasscode(passcode: string) {
  key = await deriveKey(passcode);
  clearFailures();
  set({ status: state.data ? 'ready' : state.status, hasPasscode: true });
  await flushSave();
}

/** True when the passcode opens the stored data. */
export async function checkPasscode(passcode: string): Promise<boolean> {
  if (!sealedAtRest) return false;
  try {
    await openWithPasscode(sealedAtRest, passcode);
    return true;
  } catch {
    return false;
  }
}

export async function wipe() {
  clearTimeout(saveTimer);
  await saving;
  key = null;
  sealedAtRest = null;
  clearFailures();
  await writeStored(undefined);
  set({ status: 'new', data: null, hasPasscode: false });
}

/** A backup file, encrypted with the passcode. */
export async function exportBackup(): Promise<string> {
  if (!state.data || !key) return '';
  return JSON.stringify({ app: 'trove', exported: new Date().toISOString(), ...(await seal(state.data, key)) });
}

export type ImportOutcome = 'ok' | 'need-passcode' | 'bad-passcode' | 'invalid';

export async function importBackup(text: string, passcode?: string): Promise<ImportOutcome> {
  let parsed: (Stored & { app?: string }) | undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (!parsed || parsed.app !== 'trove') return 'invalid';
  let data: AppData;
  if (parsed.enc) {
    if (!passcode) return 'need-passcode';
    try {
      const res = await openWithPasscode<AppData>(parsed, passcode);
      data = res.value;
      // Restoring on a fresh install: the backup's passcode becomes this device's passcode.
      if (!key) key = res.key;
    } catch {
      return 'bad-passcode';
    }
  } else {
    if (!parsed.data || !Array.isArray(parsed.data.accounts)) return 'invalid';
    data = parsed.data;
  }
  // An unencrypted backup (from an older version) on a fresh install still needs a passcode first.
  set({ status: key ? 'ready' : 'unprotected', data: normalize(data), hasPasscode: !!key });
  await flushSave();
  return 'ok';
}

export function update(fn: (draft: AppData) => void) {
  if (!state.data) return;
  const draft = structuredClone(state.data);
  fn(draft);
  set({ data: draft });
  scheduleSave();
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function useData(): AppData {
  const s = useStore();
  if (!s.data) throw new Error('Data is not loaded');
  return s.data;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

// ---- Actions ----

function snapshotToday(d: AppData) {
  const date = today();
  d.snapshots = d.snapshots.filter((s) => s.date !== date);
  d.snapshots.push(makeSnapshot(d.accounts, date));
}

export function saveAccount(account: Omit<Account, 'id' | 'updatedAt'> & { id?: string }) {
  update((d) => {
    const existing = account.id ? d.accounts.find((a) => a.id === account.id) : undefined;
    if (existing) Object.assign(existing, account, { updatedAt: today() });
    else d.accounts.push({ ...account, id: uid(), updatedAt: today() });
    snapshotToday(d);
  });
}

export function setBalance(id: string, balance: number) {
  update((d) => {
    const a = d.accounts.find((x) => x.id === id);
    if (!a) return;
    a.balance = balance;
    a.updatedAt = today();
    snapshotToday(d);
  });
}

export function deleteAccount(id: string) {
  update((d) => {
    d.accounts = d.accounts.filter((a) => a.id !== id);
    for (const g of d.goals) g.accountIds = g.accountIds.filter((x) => x !== id);
    snapshotToday(d);
  });
}

export function saveTransaction(t: Omit<Transaction, 'id'> & { id?: string }) {
  update((d) => {
    const existing = t.id ? d.transactions.find((x) => x.id === t.id) : undefined;
    if (existing) {
      // Remember a manual recategorization for next time this merchant shows up.
      if (existing.categoryId !== t.categoryId) d.merchantRules[t.merchant.trim().toLowerCase()] = t.categoryId;
      Object.assign(existing, t);
    } else d.transactions.push({ ...t, id: uid() });
    d.transactions.sort((a, b) => b.date.localeCompare(a.date));
  });
}

/** Put every transaction from this merchant in the category. Returns how many changed. */
export function recategorizeMerchant(merchant: string, categoryId: string): number {
  const k = merchant.trim().toLowerCase();
  let n = 0;
  update((d) => {
    d.merchantRules[k] = categoryId;
    for (const t of d.transactions) {
      if (t.merchant.trim().toLowerCase() === k && t.categoryId !== categoryId) {
        t.categoryId = categoryId;
        n++;
      }
    }
  });
  return n;
}

export function deleteTransaction(id: string) {
  update((d) => {
    d.transactions = d.transactions.filter((t) => t.id !== id);
  });
}

export interface ImportRow {
  date: string;
  merchant: string;
  amount: number;
  category?: string;
}

/** Adds rows that are not already there (same day, amount and merchant). Returns counts. */
export function importTransactions(rows: ImportRow[], accountId?: string): { added: number; duplicates: number } {
  let added = 0;
  let duplicates = 0;
  update((d) => {
    const sig = (t: { date: string; amount: number; merchant: string }) => `${t.date}|${t.amount.toFixed(2)}|${t.merchant.trim().toLowerCase()}`;
    const seen = new Set(d.transactions.map(sig));
    const byName = new Map(d.categories.map((c) => [c.name.toLowerCase(), c.id]));
    for (const r of rows) {
      if (seen.has(sig(r))) {
        duplicates++;
        continue;
      }
      seen.add(sig(r));
      const fromFile = r.category ? byName.get(r.category.toLowerCase()) : undefined;
      d.transactions.push({
        id: uid(),
        date: r.date,
        amount: r.amount,
        merchant: r.merchant,
        categoryId: fromFile ?? guessCategory(r.merchant, r.amount, d.merchantRules),
        accountId,
      });
      added++;
    }
    d.transactions.sort((a, b) => b.date.localeCompare(a.date));
  });
  return { added, duplicates };
}
