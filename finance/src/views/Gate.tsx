import { useEffect, useState } from 'react';
import { Field, NumberInput, pickFile } from '../components/ui';
import { today } from '../lib/dates';
import { demoData, emptyData } from '../lib/demo';
import { MIN_PASSCODE, passcodeProblem, waitRemaining } from '../lib/lockout';
import { importBackup, setPasscode, start, unlock, wipe } from '../lib/store';

const Mark = () => (
  <svg className="mark" viewBox="0 0 512 512" aria-hidden>
    <rect width="512" height="512" fill="#14151a" />
    <path d="M120 344 L208 256 L272 304 L392 168" fill="none" stroke="#f6f5f1" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="392" cy="168" r="30" fill="#3987e5" />
  </svg>
);

function PasscodeFields({ pass, repeat, onPass, onRepeat }: { pass: string; repeat: string; onPass: (v: string) => void; onRepeat: (v: string) => void }) {
  return (
    <>
      <div className="field-row">
        <Field label="Passcode">
          <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => onPass(e.target.value)} />
        </Field>
        <Field label="Repeat it">
          <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => onRepeat(e.target.value)} />
        </Field>
      </div>
      <p className="note" style={{ padding: 0 }}>
        At least {MIN_PASSCODE} characters. Trove asks for it every time it opens, and it is the key your data is encrypted with. Nobody can reset it, so a forgotten passcode means starting over from a backup.
      </p>
    </>
  );
}

export function Welcome() {
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | undefined>(35);
  const [pass, setPass] = useState('');
  const [repeat, setRepeat] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async (sample: boolean) => {
    const problem = passcodeProblem(pass, repeat);
    if (problem) return setErr(problem);
    setBusy(true);
    const data = sample ? demoData(today()) : emptyData();
    if (!sample) data.profile = { ...data.profile, name: name.trim(), age: age && age >= 16 && age <= 100 ? Math.round(age) : 35 };
    await start(data, pass);
  };
  const restore = async () => {
    const text = await pickFile('.json,application/json');
    if (text === null) return;
    let outcome = await importBackup(text);
    if (outcome === 'need-passcode') {
      const p = prompt('Enter the passcode this backup was saved with. It becomes the passcode on this device.');
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
        <li>Locked with your passcode. No account, no server, nothing leaves this phone.</li>
      </ul>
      <div className="field-row">
        <Field label="First name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Age">
          <NumberInput value={age} onChange={setAge} />
        </Field>
      </div>
      <PasscodeFields pass={pass} repeat={repeat} onPass={setPass} onRepeat={setRepeat} />
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

/** Shown when data exists without a passcode. Nothing is displayed until one is set. */
export function CreatePasscode() {
  const [pass, setPass] = useState('');
  const [repeat, setRepeat] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const problem = passcodeProblem(pass, repeat);
    if (problem) return setErr(problem);
    setBusy(true);
    await setPasscode(pass);
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
      <h1>Set a passcode to continue</h1>
      <p className="muted">Trove now keeps everything encrypted behind a passcode. Choose one to protect the data already on this device.</p>
      <PasscodeFields pass={pass} repeat={repeat} onPass={setPass} onRepeat={setRepeat} />
      {err && <p className="error">{err}</p>}
      <button className="btn" type="submit" disabled={busy}>
        Protect my data
      </button>
    </form>
  );
}

export function Lock() {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => waitRemaining());

  // Count down while further tries are held back.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(waitRemaining()), 500);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!pass || busy || wait > 0) return;
    setBusy(true);
    const result = await unlock(pass);
    setBusy(false);
    if (result !== 'ok') {
      setErr(result === 'wrong');
      setPass('');
      setWait(waitRemaining());
    }
  };
  const seconds = Math.ceil(wait / 1000);
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
        <input className="input" type="password" autoComplete="current-password" autoFocus value={pass} disabled={wait > 0} onChange={(e) => setPass(e.target.value)} />
      </Field>
      {wait > 0 ? (
        <p className="error">Too many wrong tries. Try again in {seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`}.</p>
      ) : (
        err && <p className="error">That passcode is not right.</p>
      )}
      <button className="btn" type="submit" disabled={!pass || busy || wait > 0}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button
        className="btn danger"
        type="button"
        onClick={() => {
          const typed = prompt('Without the passcode the data cannot be recovered. To erase everything on this device and start over, type ERASE.');
          if (typed?.trim().toUpperCase() === 'ERASE') wipe();
        }}
      >
        Forgot it? Erase and start over
      </button>
    </form>
  );
}
