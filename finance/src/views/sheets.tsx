import { useMemo, useState } from 'react';
import { Columns, LineChart, Meter } from '../components/charts';
import { Field, NumberInput, Seg, Sheet, pickFile } from '../components/ui';
import { accountsSeries, flow, spendByCategory, txInMonth } from '../lib/analytics';
import { readTransactionsCsv, type CsvResult } from '../lib/csv';
import { dayLabel, daysBetween, monthLabel, monthOf, monthsEnding, today } from '../lib/dates';
import { money, moneyCents, moneyCompact, uid } from '../lib/format';
import { goalStatus } from '../lib/goals';
import { deleteAccount, deleteTransaction, importTransactions, recategorizeMerchant, saveAccount, saveTransaction, update, useData } from '../lib/store';
import { ACCOUNT_TYPE_LABEL, ASSET_CLASSES, ASSET_CLASS_LABEL, isLiability, type AccountType, type AssetMix, type Goal } from '../lib/types';
import { useNav } from '../nav';
import { TxRow } from './shared';

// ---- Transaction ----

export function TransactionSheet({ id }: { id?: string }) {
  const data = useData();
  const nav = useNav();
  const existing = data.transactions.find((t) => t.id === id);
  const [kind, setKind] = useState<'out' | 'in'>(existing && existing.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState<number | undefined>(existing ? Math.abs(existing.amount) : undefined);
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? 'other');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [touchedCat, setTouchedCat] = useState(!!existing);

  const pickKind = (k: 'out' | 'in') => {
    setKind(k);
    if (!touchedCat) setCategoryId(k === 'in' ? 'paycheck' : 'other');
  };
  const valid = amount !== undefined && amount > 0 && merchant.trim() !== '' && date;

  const save = () => {
    if (!valid) return;
    const name = merchant.trim();
    const changedCat = existing && existing.categoryId !== categoryId;
    saveTransaction({ id: existing?.id, date, amount: kind === 'in' ? amount! : -amount!, merchant: name, categoryId, accountId: accountId || undefined, note: note.trim() || undefined });
    if (changedCat) {
      const others = data.transactions.filter((t) => t.id !== existing!.id && t.merchant.trim().toLowerCase() === name.toLowerCase() && t.categoryId !== categoryId).length;
      const cat = data.categories.find((c) => c.id === categoryId)?.name;
      if (others > 0 && confirm(`Move the other ${others} "${name}" transaction${others === 1 ? '' : 's'} to ${cat} too?`)) recategorizeMerchant(name, categoryId);
    }
    nav.close();
  };

  return (
    <Sheet title={existing ? 'Edit transaction' : 'Add transaction'} onClose={nav.close}>
      <Seg value={kind} onChange={pickKind} options={[['out', 'Money out'], ['in', 'Money in']]} />
      <Field label="Amount">
        <NumberInput value={amount} onChange={setAmount} placeholder="0.00" autoFocus={!existing} />
      </Field>
      <Field label={kind === 'in' ? 'From' : 'Merchant'}>
        <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={kind === 'in' ? 'Employer' : 'Where it was spent'} />
      </Field>
      <div className="field-row">
        <Field label="Date">
          <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Category">
          <select
            className="input"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setTouchedCat(true);
            }}
          >
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {data.accounts.length > 0 && (
        <Field label="Account (optional)" hint="For your reference. Balances are only changed when you update them yourself.">
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">None</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className="btn" disabled={!valid} onClick={save}>
        Save
      </button>
      {existing && (
        <button
          className="btn danger"
          onClick={() => {
            deleteTransaction(existing.id);
            nav.close();
          }}
        >
          Delete transaction
        </button>
      )}
    </Sheet>
  );
}

// ---- Account ----

const TYPE_OPTIONS: AccountType[] = ['cash', 'investment', 'retirement', 'property', 'other_asset', 'credit', 'loan', 'mortgage'];

export function AccountSheet({ id }: { id?: string }) {
  const data = useData();
  const nav = useNav();
  const existing = data.accounts.find((a) => a.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'cash');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [balance, setBalance] = useState<number | undefined>(existing?.balance);
  const [rate, setRate] = useState<number | undefined>(existing?.rate);
  const [mix, setMix] = useState<AssetMix>(existing?.mix ?? {});
  const now = today();

  const invests = type === 'investment' || type === 'retirement';
  const hasRate = type === 'cash' || isLiability(type);
  const mixTotal = ASSET_CLASSES.reduce((s, c) => s + (mix[c] ?? 0), 0);
  const mixOk = !invests || mixTotal === 0 || Math.round(mixTotal) === 100;
  const valid = name.trim() !== '' && balance !== undefined && balance >= 0 && mixOk;
  const history = useMemo(() => (existing ? accountsSeries(data, [existing.id], now) : []), [data, existing, now]);

  const save = () => {
    if (!valid) return;
    const cleanMix = Object.fromEntries(Object.entries(mix).filter(([, v]) => (v ?? 0) > 0)) as AssetMix;
    saveAccount({
      id: existing?.id,
      name: name.trim(),
      type,
      institution: institution.trim() || undefined,
      balance: balance!,
      rate: hasRate ? rate : undefined,
      mix: invests && mixTotal > 0 ? cleanMix : undefined,
    });
    nav.close();
  };

  return (
    <Sheet title={existing ? existing.name : 'Add account'} onClose={nav.close}>
      <Field label={isLiability(type) ? 'Amount owed' : type === 'property' || type === 'other_asset' ? 'Current value' : 'Balance'} hint={existing ? `Last updated ${dayLabel(existing.updatedAt, true)}. Saving records today's balance in your history.` : undefined}>
        <NumberInput value={balance} onChange={setBalance} placeholder="0" autoFocus={!!existing} />
      </Field>
      {existing && history.length > 2 && (
        <div className="card">
          <LineChart
            label="Balance history"
            height={150}
            points={history.map((p) => ({ x: daysBetween(history[0].date, p.date), y: p.value }))}
            yFormat={moneyCompact}
            tip={(i) => ({ title: dayLabel(history[i].date, true), rows: [['', money(history[i].value)]] })}
          />
        </div>
      )}
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Everyday Checking" />
      </Field>
      <div className="field-row">
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
                {isLiability(t) ? ' (owed)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Institution (optional)">
          <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </Field>
      </div>
      {hasRate && (
        <Field label={isLiability(type) ? 'Interest rate (APR %)' : 'Interest earned (APY %)'} hint="Optional. Used to spot costly debt and idle cash.">
          <NumberInput value={rate} onChange={setRate} placeholder="e.g. 4.5" />
        </Field>
      )}
      {invests && (
        <div className="field">
          <span>What it holds (optional, % of the account)</span>
          <div className="field-row">
            {ASSET_CLASSES.map((c) => (
              <Field key={c} label={ASSET_CLASS_LABEL[c]}>
                <NumberInput value={mix[c]} onChange={(v) => setMix({ ...mix, [c]: v })} placeholder="0" />
              </Field>
            ))}
          </div>
          <span className={mixOk ? 'hint' : 'error'}>{mixTotal === 0 ? 'Leave blank if you are not sure.' : `Adds up to ${mixTotal}%${mixOk ? '' : '. It needs to be 100%.'}`}</span>
        </div>
      )}
      <button className="btn" disabled={!valid} onClick={save}>
        Save
      </button>
      {existing && (
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Remove ${existing.name}? Past net worth history keeps its old balances.`)) {
              deleteAccount(existing.id);
              nav.close();
            }
          }}
        >
          Remove account
        </button>
      )}
    </Sheet>
  );
}

// ---- Goal ----

const GOAL_ICONS = ['🎯', '🏡', '🛟', '✈️', '🚗', '🎓', '💍', '👶', '💳', '🏖️'];

export function GoalSheet({ id }: { id?: string }) {
  const data = useData();
  const nav = useNav();
  const existing = data.goals.find((g) => g.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? '🎯');
  const [kind, setKind] = useState<Goal['kind']>(existing?.kind ?? 'save');
  const [target, setTarget] = useState<number | undefined>(existing?.target || undefined);
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? '');
  const [accountIds, setAccountIds] = useState<string[]>(existing?.accountIds ?? []);
  const now = today();

  const choices = data.accounts.filter((a) => (kind === 'payoff' ? isLiability(a.type) : !isLiability(a.type)));
  const linked = choices.filter((a) => accountIds.includes(a.id));
  const linkedTotal = linked.reduce((s, a) => s + a.balance, 0);
  const valid = name.trim() !== '' && linked.length > 0 && (kind === 'payoff' || (target ?? 0) > 0);
  const status = existing ? goalStatus(data, existing, now) : null;

  const save = () => {
    if (!valid) return;
    update((d) => {
      const goal: Goal = {
        id: existing?.id ?? uid(),
        name: name.trim(),
        icon,
        kind,
        target: kind === 'payoff' ? 0 : target!,
        targetDate: targetDate || undefined,
        accountIds: linked.map((a) => a.id),
        // Keep the original starting point unless the goal now tracks different debts.
        startAmount: existing && existing.kind === kind && existing.accountIds.join() === linked.map((a) => a.id).join() ? existing.startAmount : linkedTotal,
        createdAt: existing?.createdAt ?? now,
      };
      const i = d.goals.findIndex((g) => g.id === goal.id);
      if (i >= 0) d.goals[i] = goal;
      else d.goals.push(goal);
    });
    nav.close();
  };

  return (
    <Sheet title={existing ? 'Edit goal' : 'New goal'} onClose={nav.close}>
      {status && (
        <div className="card">
          <div className="big">
            {money(status.done)} <span className="small muted">of {money(status.total)}</span>
          </div>
          <Meter value={status.progress} max={1} tone={status.complete ? 'done' : 'plain'} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {status.complete
              ? 'Reached. Nice work.'
              : [status.needed !== null ? `Needs ${money(status.needed)} a month` : '', status.pace !== null ? `lately ${money(Math.max(0, status.pace))} a month` : 'pace appears after a few weeks of balance updates']
                  .filter(Boolean)
                  .join(' · ')}
          </div>
        </div>
      )}
      <Seg
        value={kind}
        onChange={(k) => {
          setKind(k);
          setAccountIds([]);
        }}
        options={[['save', 'Save up'], ['payoff', 'Pay off debt']]}
      />
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'save' ? 'e.g. House down payment' : 'e.g. Pay off the Visa'} />
      </Field>
      <div className="chips">
        {GOAL_ICONS.map((i) => (
          <button key={i} className="chip" aria-pressed={i === icon} onClick={() => setIcon(i)} aria-label={`Icon ${i}`}>
            {i}
          </button>
        ))}
      </div>
      <div className="field-row">
        {kind === 'save' && (
          <Field label="Target amount">
            <NumberInput value={target} onChange={setTarget} placeholder="0" />
          </Field>
        )}
        <Field label="By (optional)">
          <input className="input" type="date" value={targetDate} min={now} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      <div className="field">
        <span>{kind === 'save' ? 'Which accounts count toward it?' : 'Which debts?'}</span>
        {choices.length === 0 ? (
          <span className="hint">{kind === 'save' ? 'Add an account first.' : 'Add a card or loan first.'}</span>
        ) : (
          <div className="chips">
            {choices.map((a) => (
              <button key={a.id} className="chip" aria-pressed={accountIds.includes(a.id)} onClick={() => setAccountIds(accountIds.includes(a.id) ? accountIds.filter((x) => x !== a.id) : [...accountIds, a.id])}>
                {a.name} · {moneyCompact(a.balance)}
              </button>
            ))}
          </div>
        )}
        <span className="hint">Progress follows the balances of these accounts.</span>
      </div>
      <button className="btn" disabled={!valid} onClick={save}>
        Save goal
      </button>
      {existing && (
        <button
          className="btn danger"
          onClick={() => {
            update((d) => {
              d.goals = d.goals.filter((g) => g.id !== existing.id);
            });
            nav.close();
          }}
        >
          Delete goal
        </button>
      )}
    </Sheet>
  );
}

// ---- Category ----

export function CategorySheet({ id, month }: { id: string; month: string }) {
  const data = useData();
  const nav = useNav();
  const category = data.categories.find((c) => c.id === id);
  const thisMonth = monthOf(today());
  const [selected, setSelected] = useState(month);
  // The last six months, or the six ending at an older month when that is what was opened.
  const months = useMemo(() => monthsEnding(month < monthsEnding(thisMonth, 6)[0] ? month : thisMonth, 6), [month, thisMonth]);
  const totals = useMemo(
    () => months.map((m) => ({ month: m, total: spendByCategory(data, txInMonth(data, m)).find((r) => r.category.id === id)?.total ?? 0 })),
    [data, months, id],
  );
  if (!category) return null;
  const txs = txInMonth(data, selected).filter((t) => t.categoryId === id);
  const spent = totals.find((t) => t.month === selected)?.total ?? 0;
  const full = totals.filter((t) => t.month !== thisMonth);
  const average = full.length ? full.reduce((s, t) => s + t.total, 0) / full.length : 0;
  const share = spent / (flow(data, txInMonth(data, selected)).spend || 1);

  return (
    <Sheet title={`${category.icon} ${category.name}`} onClose={nav.close}>
      <div className="card">
        <div className="label">{monthLabel(selected)}</div>
        <div className="hero sm">{money(spent)}</div>
        <div className="small muted">
          {(share * 100).toFixed(0)}% of the month's spending
          {average > 0 ? ` · usually ${money(average)} a month` : ''}
        </div>
        {category.budget ? (
          <>
            <Meter value={spent} max={category.budget} />
            <div className="small muted" style={{ marginTop: 6 }}>
              {spent > category.budget ? `${money(spent - category.budget)} over the ${money(category.budget)} budget` : `${money(category.budget - spent)} left of ${money(category.budget)}`}
            </div>
          </>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <Columns
            label={`${category.name} by month`}
            height={140}
            items={totals.map((t) => ({ key: t.month, label: monthLabel(t.month, 'short'), value: t.total }))}
            selected={selected}
            onSelect={setSelected}
            format={moneyCompact}
            target={category.budget}
          />
        </div>
      </div>
      <Field label="Monthly budget" hint={average > 0 ? `Your recent average is ${money(average)}. Leave empty for no budget.` : 'Leave empty for no budget.'}>
        <NumberInput
          value={category.budget}
          placeholder="No budget"
          onChange={(v) =>
            update((d) => {
              const c = d.categories.find((x) => x.id === id);
              if (c) c.budget = v && v > 0 ? v : undefined;
            })
          }
        />
      </Field>
      <div className="section-title">
        <span>Transactions</span>
        <span className="muted small">{txs.length}</span>
      </div>
      <div className="card flush">
        {txs.length ? txs.map((t) => <TxRow key={t.id} data={data} t={t} />) : <div className="empty">None in {monthLabel(selected)}.</div>}
      </div>
    </Sheet>
  );
}

// ---- CSV import ----

export function ImportSheet() {
  const data = useData();
  const nav = useNav();
  const [result, setResult] = useState<CsvResult | null>(null);
  const [flip, setFlip] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [done, setDone] = useState<{ added: number; duplicates: number } | null>(null);

  const choose = async () => {
    const text = await pickFile('.csv,text/csv,text/plain');
    if (text === null) return;
    const r = readTransactionsCsv(text);
    setResult(r);
    setFlip(r.chargesPositive);
    setDone(null);
  };
  const rows = result?.rows.map((r) => ({ ...r, amount: flip ? -r.amount : r.amount })) ?? [];
  const dates = rows.map((r) => r.date).sort();

  return (
    <Sheet title="Import transactions" onClose={nav.close}>
      {done ? (
        <div className="card empty">
          <div className="emoji-lg">✅</div>
          <p>
            Added {done.added} transaction{done.added === 1 ? '' : 's'}.{done.duplicates ? ` Skipped ${done.duplicates} already here.` : ''}
          </p>
          <button className="btn" onClick={nav.close}>
            Done
          </button>
        </div>
      ) : !result || result.error || rows.length === 0 ? (
        <>
          <p className="muted">
            Download a CSV of your transactions from your bank or card's website, then choose it here. The file is read on this device and goes nowhere else.
          </p>
          {result?.error && <p className="error">{result.error}</p>}
          {result && !result.error && rows.length === 0 && <p className="error">No transactions could be read from that file.</p>}
          <button className="btn" onClick={choose}>
            Choose a CSV file
          </button>
          <p className="note">It needs a header row with a date, a description (or merchant or payee) and an amount, or separate debit and credit columns. Importing the same file twice will not create duplicates.</p>
        </>
      ) : (
        <>
          <div className="card">
            <div className="big">{rows.length} transactions</div>
            <div className="small muted">
              {dayLabel(dates[0], true)} to {dayLabel(dates[dates.length - 1], true)}
              {result.skipped ? ` · ${result.skipped} unreadable row${result.skipped === 1 ? '' : 's'} skipped` : ''}
            </div>
          </div>
          <div className="card flush">
            {rows.slice(0, 4).map((r, i) => (
              <div className="row" key={i}>
                <span className="main">
                  <div className="name">{r.merchant}</div>
                  <div className="meta">{dayLabel(r.date, true)}</div>
                </span>
                <span className={`amt ${r.amount > 0 ? 'in' : ''}`}>
                  {r.amount > 0 ? '+' : '−'}
                  {moneyCents(Math.abs(r.amount))}
                </span>
              </div>
            ))}
          </div>
          <label className="switch-row">
            <span>
              Purchases are positive in this file<div className="small muted">Check that spending shows with a minus above.</div>
            </span>
            <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
          </label>
          {data.accounts.length > 0 && (
            <Field label="Account (optional)">
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">None</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <button className="btn" onClick={() => setDone(importTransactions(rows, accountId || undefined))}>
            Import {rows.length} transactions
          </button>
          <button className="btn ghost" onClick={choose}>
            Choose a different file
          </button>
        </>
      )}
    </Sheet>
  );
}
