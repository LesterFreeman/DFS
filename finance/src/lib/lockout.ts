// Slows down passcode guessing on the lock screen. The real protection is the encryption (each
// guess costs 600,000 rounds of key stretching); this stops someone holding the phone from
// casually trying passcode after passcode.

export const FREE_TRIES = 5;
const BASE_MS = 30_000;
const MAX_MS = 15 * 60_000;

/** How long to wait after this many wrong passcodes in a row. */
export function lockoutMs(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  return Math.min(MAX_MS, BASE_MS * 2 ** (failures - FREE_TRIES));
}

interface Record {
  failures: number;
  last: number;
}

const KEY = 'trove-lockout';

function read(): Record {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '') as Record;
    if (typeof r.failures === 'number' && typeof r.last === 'number') return r;
  } catch {
    /* nothing stored */
  }
  return { failures: 0, last: 0 };
}

/** Milliseconds until another try is allowed (0 when one is allowed now). */
export function waitRemaining(now = Date.now()): number {
  const r = read();
  // A clock set backwards must not clear the wait.
  const elapsed = Math.max(0, now - r.last);
  return Math.max(0, lockoutMs(r.failures) - elapsed);
}

export function recordFailure(now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ failures: read().failures + 1, last: now }));
  } catch {
    /* storage unavailable */
  }
}

export function clearFailures() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export const MIN_PASSCODE = 6;

/** A reason the passcode is not acceptable, or null when it is fine. */
export function passcodeProblem(passcode: string, repeat: string): string | null {
  if (passcode.length < MIN_PASSCODE) return `Use at least ${MIN_PASSCODE} characters. A longer phrase is stronger.`;
  if (/^(.)\1+$/.test(passcode) || '0123456789012345'.includes(passcode) || '9876543210987654'.includes(passcode)) return 'That one is too easy to guess.';
  if (passcode !== repeat) return 'The two passcodes do not match.';
  return null;
}
