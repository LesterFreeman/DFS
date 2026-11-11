import { useState } from 'react';
import { Field, NumberInput, Sheet, pickFile, saveFile } from '../components/ui';
import { catMap } from '../lib/analytics';
import { toCsv } from '../lib/csv';
import { today } from '../lib/dates';
import { passcodeProblem } from '../lib/lockout';
import { checkPasscode, exportBackup, importBackup, lock, setPasscode, update, useData, wipe } from '../lib/store';
import { useNav } from '../nav';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'INR', 'SGD', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'ZAR'];

export function SettingsSheet() {
  const data = useData();
  const nav = useNav();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [current, setCurrent] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const say = (m: string, isErr = false) => {
    setMsg(isErr ? '' : m);
    setErr(isErr ? m : '');
  };

  const applyPasscode = async () => {
    if (!(await checkPasscode(current))) return say('Current passcode is not right.', true);
    const problem = passcodeProblem(pass, pass2);
    if (problem) return say(problem, true);
    await setPasscode(pass);
    setPass('');
    setPass2('');
    setCurrent('');
    say('Passcode changed. Backups saved from now on use the new one.');
  };

  const backup = async () => {
    await saveFile(`trove-backup-${today()}.json`, await exportBackup(), 'application/json');
    say('Backup saved. It is encrypted with your current passcode, which you will need to restore it.');
  };
  const restore = async () => {
    const text = await pickFile('.json,application/json');
    if (text === null) return;
    if (!confirm('Replace everything in Trove with this backup?')) return;
    let outcome = await importBackup(text);
    if (outcome === 'need-passcode') {
      const p = prompt('Enter the passcode this backup was saved with.');
      if (!p) return;
      outcome = await importBackup(text, p);
    }
    say(outcome === 'ok' ? 'Backup restored.' : outcome === 'bad-passcode' ? 'That passcode does not open this backup.' : 'That file is not a Trove backup.', outcome !== 'ok');
  };
  const exportCsv = () => {
    const cats = catMap(data);
    const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
    const rows = data.transactions.map((t) => [t.date, t.merchant, t.amount.toFixed(2), cats.get(t.categoryId)?.name ?? '', t.accountId ? accounts.get(t.accountId) ?? '' : '', t.note ?? '']);
    saveFile(`trove-transactions-${today()}.csv`, toCsv([['Date', 'Description', 'Amount', 'Category', 'Account', 'Note'], ...rows]), 'text/csv');
  };
  const erase = async () => {
    if (!confirm('Erase everything in Trove on this device? This cannot be undone.')) return;
    nav.close();
    await wipe();
  };

  return (
    <Sheet title="Settings" onClose={nav.close}>
      {msg && <div className="banner">{msg}</div>}
      {err && <p className="error">{err}</p>}

      <div className="section-title">You</div>
      <div className="card stack">
        <div className="field-row">
          <Field label="Name">
            <input
              className="input"
              value={data.profile.name}
              onChange={(e) =>
                update((d) => {
                  d.profile.name = e.target.value;
                })
              }
            />
          </Field>
          <Field label="Age">
            <NumberInput
              value={data.profile.age}
              onChange={(v) =>
                v &&
                v >= 16 &&
                v <= 100 &&
                update((d) => {
                  d.profile.age = Math.round(v);
                })
              }
            />
          </Field>
        </div>
        <Field label="Currency">
          <select
            className="input"
            value={data.profile.currency}
            onChange={(e) =>
              update((d) => {
                d.profile.currency = e.target.value;
              })
            }
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="section-title">Passcode and privacy</div>
      <div className="card stack">
        <p className="small muted">
          Everything you enter is encrypted with your passcode and stored only in this browser on this device. Trove has no server, no account and no analytics, and the app is built so that it cannot make network requests.
        </p>
        <Field label="Lock when away for" hint="Trove always locks when it is closed or reloaded.">
          <select
            className="input"
            value={data.profile.autoLockMin}
            onChange={(e) =>
              update((d) => {
                d.profile.autoLockMin = Number(e.target.value);
              })
            }
          >
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
          </select>
        </Field>
        <button className="btn secondary" onClick={() => lock().then(nav.close)}>
          Lock now
        </button>
        <Field label="Current passcode">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="field-row">
          <Field label="New passcode">
            <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
          <Field label="Repeat it">
            <input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </Field>
        </div>
        <button className="btn secondary" onClick={applyPasscode} disabled={!pass || !current}>
          Change passcode
        </button>
        <p className="small muted">There is no way to recover a forgotten passcode: nobody else has a copy of the key. Keep a backup.</p>
      </div>

      <div className="section-title">Your data</div>
      <div className="card stack">
        <p className="small muted">A backup is the only copy outside this device. Save one now and then, and use it to move to a new phone.</p>
        <div className="btn-row">
          <button className="btn secondary" onClick={backup}>
            Save a backup
          </button>
          <button className="btn secondary" onClick={restore}>
            Restore
          </button>
        </div>
        <button className="btn ghost" onClick={exportCsv} disabled={!data.transactions.length}>
          Export transactions as CSV
        </button>
        <button className="btn danger" onClick={erase}>
          Erase everything
        </button>
      </div>
      <p className="note">
        {data.accounts.length} accounts · {data.transactions.length} transactions · {data.snapshots.length} days of balance history
      </p>
    </Sheet>
  );
}
