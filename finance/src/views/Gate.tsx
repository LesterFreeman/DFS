import { useState } from 'react';
import { Field, NumberInput, pickFile } from '../components/ui';
import { today } from '../lib/dates';
import { demoData, emptyData } from '../lib/demo';
import { importBackup, start, unlock, wipe } from '../lib/store';

const Mark = () => (
  <svg className="mark" viewBox="0 0 512 512" aria-hidden>
    <rect width="512" height="512" fill="#14151a" />
    <path d="M120 344 L208 256 L272 304 L392 168" fill="none" stroke="#f6f5f1" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="392" cy="168" r="30" fill="#3987e5" />
  </svg>
);

export function Welcome() {
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | undefined>(35);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async (sample: boolean) => {
    if (pass && pass.length < 4) return setErr('Use at least 4 characters for the passcode, or leave it empty.');
    setBusy(true);
    const data = sample ? demoData(today()) : emptyData();
    if (!sample) data.profile = { ...data.profile, name: name.trim(), age: age && age >= 16 && age <= 100 ? Math.round(age) : 35 };
    await start(data, pass || undefined);
  };
  const restore = async () => {
    const text = await pickFile('.json,application/json');
    if (text === null) return;
    let outcome = await importBackup(text);
    if (outcome === 'need-passcode') {
      const p = prompt('This backup is encrypted. Enter the passcode it was saved with.');
      if (!p) return;
      outcome = await importBackup(text, p);
    }
    if (outcome !== 'ok') setErr(outcome === 'bad-passcode' ? 'That passcode does not open this backup.' : 'That file is not a Trove backup.');
  };

  return (
    <div className="gate">
      <Mark />
      <h1>Your money, on your device only.</h1>
      <ul>
        <li>See where it goes: spending by category, month by month.</li>
        <li>Watch net worth grow and test your plan for the future.</li>
        <li>Get specific suggestions for what to do next.</li>
        <li>No account, no server, no bank logins. Nothing leaves this phone.</li>
      </ul>
      <div className="field-row">
        <Field label="First name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Age">
          <NumberInput value={age} onChange={setAge} />
        </Field>
      </div>
      <Field label="Passcode (optional)" hint="Encrypts your data on this device. It cannot be recovered if you forget it. You can add one later in Settings.">
        <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={busy} onClick={() => begin(false)}>
        Get started
      </button>
      <button className="btn secondary" disabled={busy} onClick={() => begin(true)}>
        Look around with sample data
      </button>
      <button className="btn ghost" onClick={restore}>
        Restore a backup
      </button>
    </div>
  );
}

export function Lock() {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pass || busy) return;
    setBusy(true);
    const ok = await unlock(pass);
    setBusy(false);
    if (!ok) {
      setErr(true);
      setPass('');
    }
  };
  return (
    <form
      className="gate"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Mark />
      <h1>Trove is locked</h1>
      <Field label="Passcode">
        <input className="input" type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      {err && <p className="error">That passcode is not right.</p>}
      <button className="btn" type="submit" disabled={!pass || busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button
        className="btn danger"
        type="button"
        onClick={() => {
          if (confirm('Erase everything in Trove on this device and start over? Without the passcode the data cannot be recovered.')) wipe();
        }}
      >
        Forgot it? Erase and start over
      </button>
    </form>
  );
}
