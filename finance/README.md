# Trove

A private money app for your phone: spending by category, net worth over time, a projection you
can tinker with, and recommendations worked out from your own numbers. A static web app with no
backend: React, Vite and TypeScript.

## Privacy

- **No server, no account, no bank logins.** Everything you enter is stored in your browser's
  IndexedDB on your device and nowhere else.
- **The app cannot phone home.** The production build carries a Content-Security-Policy with
  `connect-src 'none'`, so the page is not allowed to make network requests at all, and it loads
  no third-party scripts, fonts or analytics. The only runtime dependency is React.
- **A passcode is required.** Setup does not finish without one, and nothing is ever written to
  storage unencrypted: the data is AES-256-GCM ciphertext, keyed by PBKDF2-SHA256 (600,000 rounds)
  from the passcode. The key is held in memory only. The app locks whenever it is closed or
  reloaded and after 1, 5 or 15 minutes in the background, blanks the screen while in the
  background, and holds back guesses after five wrong tries (30 seconds, doubling to 15 minutes).
  A forgotten passcode cannot be recovered.
- **Backups are yours.** Settings saves a backup file, encrypted with the passcode, and restores
  from one. That file is the only copy outside the device.

What this means in practice: transactions come from CSV exports you download from your bank, or
from manual entry, and account balances are typed in by you. There is no automatic bank sync,
because that needs a third party holding your credentials.

Hosting the app (for example on GitHub Pages) publishes the code, not your data. Someone else who
opens the URL gets an empty app in their own browser and can never see yours. To stop strangers
loading the app at all, host it behind an access-controlled service instead (for example
Cloudflare Pages with Cloudflare Access).

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
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # static files in dist/, hostable anywhere
```

On your phone, open the hosted URL and use **Add to Home Screen**. It then opens full screen and
works offline. Choose "Look around with sample data" on first launch to see it populated; erase it
from Settings when you are ready to enter your own.

To host it on GitHub Pages, enable Pages for the repository (Settings > Pages > Source: GitHub
Actions) and run the `deploy` workflow.

## Importing transactions

Any CSV with a header row containing a date, a description (or merchant / payee / name) and an
amount (or separate debit and credit columns) works. Lines above the header are ignored, card
exports where purchases are positive are detected, and importing the same file twice does not
create duplicates.
