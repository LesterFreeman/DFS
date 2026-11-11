# Trove

A private money app for your phone: spending by category, net worth over time, a projection you
can tinker with, and recommendations worked out from your own numbers. It lives in this folder and
shares nothing with the DFS app except the repository.

## Privacy

- **No server, no account, no bank logins.** Everything you enter is stored in your browser's
  IndexedDB on your device and nowhere else.
- **The app cannot phone home.** The production build carries a Content-Security-Policy with
  `connect-src 'none'`, so the page is not allowed to make network requests at all, and it loads
  no third-party scripts, fonts or analytics. The only runtime dependency is React.
- **Optional passcode.** With a passcode set, the data is stored as AES-256-GCM ciphertext, keyed
  by PBKDF2-SHA256 (600,000 rounds) from the passcode. The key is held in memory only, the app
  locks on reload and after three minutes in the background, and a forgotten passcode cannot be
  recovered.
- **Backups are yours.** Settings saves a backup file (encrypted when a passcode is set) and
  restores from one. That file is the only copy outside the device.

What this means in practice: transactions come from CSV exports you download from your bank, or
from manual entry, and account balances are typed in by you. There is no automatic bank sync,
because that needs a third party holding your credentials.

Hosting the app (for example on GitHub Pages) publishes the code, not your data. One thing to
know: browser storage is shared by every page on the same origin, so other sites served from the
same `<user>.github.io` could in principle read unencrypted data. Set a passcode.

## What is in it

| Tab | What it does |
| --- | --- |
| **Home** | Net worth, this month's spending against last month, the two most pressing recommendations, goals, recent activity. |
| **Spending** | Month by month: total, six-month trend, every category with its share or budget, searchable transactions. Tap a category for its trend, budget and transactions. CSV import with automatic categories that learn from your corrections. |
| **Net worth** | Assets minus liabilities over 3M / 6M / 1Y / all time, investment mix, and every account. Each balance update adds a point to the history. |
| **Plan** | Monte Carlo projection to age 95 with sliders for monthly investing, retirement age, retirement spending and returns. Compare a what-if against your saved plan. Savings and debt-payoff goals with pace tracking. |
| **Advice** | Recommendations sorted into act / watch / going well: emergency fund, high-interest debt, savings rate, categories running hot, budgets, recurring charges, fees, idle cash, retirement odds, asset mix, goals, stale balances. |

The recommendation rules are in `src/lib/insights.ts` and the projection model in
`src/lib/projection.ts`. Both are plain functions with tests.

## Run it

```
cd finance
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # static files in dist/, hostable anywhere
```

On your phone, open the hosted URL and use **Add to Home Screen**. It then opens full screen and
works offline. Choose "Look around with sample data" on first launch to see it populated; erase it
from Settings when you are ready to enter your own.

Pushing to `main` deploys it with the rest of the site at `<pages-url>/finance/`.

## Importing transactions

Any CSV with a header row containing a date, a description (or merchant / payee / name) and an
amount (or separate debit and credit columns) works. Lines above the header are ignored, card
exports where purchases are positive are detected, and importing the same file twice does not
create duplicates.
