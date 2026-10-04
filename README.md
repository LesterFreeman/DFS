# DFS Value Ranker — DraftKings NFL Classic, cash games

Ranks main-slate NFL players by a transparent, adjustable **cash-game value score**, and builds
optimal lineups under the $50,000 cap. Free data, free hosting.

```
GitHub Actions (cron + manual)          data branch                     GitHub Pages
┌──────────────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
│ pipeline/ (Python)           │   │ latest/*.json        │   │ web/ (React, static)         │
│  DraftKings salaries         │──▶│ cache/<source>.json  │──▶│  value table + sliders       │
│  Sleeper/ESPN/FP/CBS proj.   │   │ history/<season>/wkN │   │  player detail               │
│  nflverse ids/schedule/stats │   │ overrides/           │   │  lineup optimizer (glpk.js)  │
└──────────────────────────────┘   └──────────────────────┘   └──────────────────────────────┘
```

## Contents

- [Stage 1: data pipeline](#stage-1--data-pipeline)
- [Stage 2: value model](#stage-2--value-model)
- [Stage 3: web app & deployment](#stage-3--web-app--deployment)
- [Stage 4: lineup optimizer](#stage-4--lineup-optimizer)
- [Backtest](#backtest)
- [Data sources](#data-sources)
- [Troubleshooting](#troubleshooting)

---

## Stage 1 — data pipeline

### What it does

1. **Salaries.** Finds the DraftKings **Sunday–Monday** Classic draft group for the upcoming
   Sunday (Sunday afternoon + Sunday night + Monday night) and pulls every player:
   - It picks the group whose label reads like "(Sun-Mon)".
   - If there isn't one, it picks the Sunday-starting Classic group with the most games.
   - If nothing bigger than Main is listed, it falls back to Main and says so in the source report.

   Set `[slate] draftkings_slate = "main"` in `config.toml` for Sunday afternoon only. If you commit
   `overrides/DKSalaries.csv` to the `data` branch, that file wins while its slate hasn't been played.
2. **Season and week.** Taken from the slate's first kickoff and the nflverse schedule, with Sleeper's
   `state/nfl` as a fallback. Both can be forced in `config.toml`.
3. **Projections.** Sleeper, ESPN, CBS, a Vegas DST model and seven projection websites (see
   [Projection websites](#projection-websites)). Every source's
   **stat line is rescored with DraftKings rules** instead of trusting each site's own "PPR" total:
   - ESPN takes −2 per INT where DraftKings takes −1.
   - Nobody else pays DraftKings' 300/100/100-yard bonuses.
   - Bonuses are priced as `3 × P(yards ≥ threshold)` under a normal approximation, because a
     95-yard projection is worth about 1.3 bonus points, not 0 or 3.
   - DST points-allowed tiers are handled the same way.
4. **Name matching** (`pipeline/dfs/match.py`), first hit wins:
   1. DST by team.
   2. Site ID via the DynastyProcess/nflverse crosswalk.
   3. Normalized name + position + team.
   4. Name + position when unique on the slate (catches trades and stale team codes).
   5. Fuzzy match (≥ 88) within the same team + position.

   Normalizing handles `D.J.`/`DJ`, Jr./Sr./III, apostrophes, hyphens and accents. An alias
   table covers nicknames (`Hollywood Brown` → `Marquise Brown`). Anything unmatched is listed in
   `sources.json → match_report`.
5. **Status.** Sleeper's players file (about 5 MB) is downloaded at most once every 20 hours,
   because Sleeper asks callers to fetch it no more than once a day (`[cache]` in
   `config.toml`). DraftKings' tag is refreshed with the salaries on every run, so Sunday
   inactives still come through. DraftKings' tag is primary. If Sleeper says D, O or IR while DraftKings says
   active, Sleeper wins, and any disagreement sets `status_conflict`.
6. **Consensus and floor.** Weighted mean and spread across sources. Floor model: see Stage 2.

### Failure isolation

Each source runs on its own. A source is **failed** if it throws, returns fewer than
`min_rows`, or covers less than `min_coverage` (60%) of fantasy-relevant slate players. A 200 OK
page that's really a Cloudflare challenge is caught this way.

A failed source falls back to its **last good snapshot** for the same week, up to 72 hours old,
and is marked **stale**. `sources.json` records status, fetch time, rows, coverage, error and
stale age for every source. The workflow opens (or comments on) a GitHub issue titled
**"Data source failures"**, which emails you, and closes it when everything recovers.

The run only fails outright (red X) if **no salaries** are available: not live, not CSV, not cached.

### Output (`data/latest/`)

| file | contents |
|---|---|
| `players.json` | one row per slate player: salary, status, per-source projections, consensus `proj`, `proj_sd`, min/max, `floor`, `sigma`, `hist_games`, implied team totals, `in_pool`, match method per source |
| `slate.json` | season/week, games with kickoff, spread, total and implied totals, byes, off-slate teams, config echoes |
| `sources.json` | per-source health plus the match report (unmatched records, slate players with no projection) |
| `backtest.json` | every graded past week (compact player rows with actual points) and accuracy metrics; see [Backtest](#backtest) |

### Run it locally

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q                              # 30 tests, offline

# Offline sample slate (fixtures are generated by tests/fixtures/make_fixtures.py)
python -m dfs.build --fixtures tests/fixtures --now 2026-09-25T12:00:00Z --sample --out /tmp/dfs

# Live: probe every source and print the health table without writing anything
python -m dfs.build --dry-run

# Live, writing ../data/latest (+ cache, history)
python -m dfs.build
```

### Deploy (GitHub Actions)

1. Push this repo to GitHub and merge to your **default branch**. Scheduled workflows only run
   from there.
2. **Settings → Actions → General → Workflow permissions:** choose *Read and write*.
3. **Actions → pipeline → Run workflow** once. The first run creates the `data` branch.
4. Schedule (UTC, see `.github/workflows/pipeline.yml`):
   - daily around 6am ET;
   - Friday and Saturday evenings;
   - five Sunday runs bracketing the 1pm and late-game inactives.

   GitHub often starts cron runs 15–60 minutes late. Use **Run workflow** when timing matters.
5. **Manual salary override (needed if DraftKings blocks GitHub's servers):**
   1. On DraftKings, open any main-slate Classic contest and click **Export to CSV** (or
      *Export lineups to CSV*) to download `DKSalaries.csv`.
   2. On GitHub, go to the repo's **Add file → Upload files**, drop the file in the repo root,
      and commit.
   3. **Actions → pipeline → Run workflow.**

   The file is used while its slate is upcoming and ignored once its last game (e.g. Monday
   night) has been played. Replace it weekly. Projections, injuries and everything else stay
   automatic.

   Every game in the file is included, so a Sunday–Monday export includes the Sunday-night and
   Monday-night players. To keep only the Sunday-afternoon games instead, set
   `[slate] csv_main_slate_only = true` in `config.toml`.

GitHub disables cron workflows in public repos after 60 days without repository activity. The
bot's data commits may or may not count toward that. If it happens you'll get an email, and
re-enabling it is one click on the Actions tab.

---

## Stage 2 — value model

The pipeline produces the inputs: consensus projection, cross-source spread and floor. The
browser (`web/src/lib/value.ts`) computes the components and the overall score, so weight
sliders and the target lineup total **T** take effect instantly without re-running anything.

### Value pool

These players are excluded from the pool, but still shown in the table greyed out, with the reason:
- players with no projection;
- players who are D, O or IR (and optionally Q);
- players below the position minimum projection (QB 10, RB/WR 5, TE 4, DST 3).

The minimum projection keeps a dozen near-zero $3,000 players from distorting the statistics.

### Components

Each component is a z-score **within the player's position**, clipped to ±3.

| component | raw quantity | why |
|---|---|---|
| **Efficiency** | `proj / (salary / 1000)` | points per $1K, the classic value measure |
| **Positional** | `proj − (a + b·salary)`, where the line is fitted per position on this slate | points above what this slate's pricing implies for that salary. It fixes efficiency's bias toward min-priced players and acts as "points above replacement at that salary". |
| **Budget impact** | `proj − salary × T / 50,000` | points above the pace a T-point lineup needs. An absolute surplus rewards players who add points in big chunks, and a lineup only has 9 slots. |
| **Reliability** | `½·z(−sd/proj) + ½·z(floor/proj) − 0.5 if Q` | agreement across sources plus how bad a bad week is. Single-source players get the position's worst-decile disagreement. |

**Why budget impact isn't the ratio you described.** `(proj/T) / (salary/50,000)` equals
`efficiency × 50/T`, a rescaled copy of efficiency, so including it would count efficiency twice.
The surplus form carries information efficiency doesn't: a $9,000 player and a $3,000 player at
the same 3.0 pts/$1K get the same efficiency score, but the $9,000 player adds 3× the surplus.

**Overall score:** `value = Σ wᵢ·zᵢ / Σ wᵢ`

| preset | efficiency | positional | budget | reliability |
|---|---|---|---|---|
| Cash default | 0.25 | 0.30 | 0.20 | 0.25 |
| Pure efficiency | 1 | 0 | 0 | 0 |
| Safe floor | 0.15 | 0.25 | 0.15 | 0.45 |
| Points surplus | 0.10 | 0.30 | 0.45 | 0.15 |

Why these defaults: positional value is the least biased single measure, so it gets the most
weight. Efficiency and reliability are the cash-game staples. Budget impact is partly
correlated with the other two, so it gets less.

Because the scores are relative to each position, value is directly comparable within a
position, but only roughly comparable across positions. The optimizer (Stage 4) is what
trades positions off against each other properly.

### Floor model (pipeline, `pipeline/dfs/floor.py`)

Free sources don't publish floors, so the pipeline estimates one from history:

1. Take each player's week-to-week coefficient of variation (sd ÷ mean) of actual DraftKings
   points, from nflverse weekly stats for this season and last.
2. Shrink it toward a position prior: `cv = (n·cv_player + 8·cv_prior)/(n + 8)`.
3. Apply it to this week's projection:
   - `sigma = proj·cv`
   - `floor = max(0, proj − 0.84·sigma)`, about the 20th percentile.

DSTs, rookies and players with little history get the prior: QB .40, RB .55, WR .62, TE .68, DST .80.

### Tests

```bash
cd pipeline && python -m pytest -q     # includes floor tests
cd web && npm ci && npm test           # value model tests (vitest)
```

---

## Stage 3 — web app & deployment

A static React + TypeScript app (Vite) in `web/`. It reads `./data/{players,slate,sources}.json`.

- **Source health bar.** One chip per source with its age, or failed/stale. *Details* opens the
  full table (rows, coverage, access type, error) and the name-match report.
- **Value weights.** Presets, four sliders, target lineup total T, the Q penalty and an
  "exclude Q" switch. Changes apply instantly and are remembered in your browser.
- **Filters.**
  - Always visible: position tabs (including FLEX), team, name search.
  - Under *More filters*: salary, projection and value ranges; status checkboxes; "value pool only".
- **Table.**
  - Click any header to sort.
  - The player column stays pinned while you scroll sideways on a phone.
  - Component z-scores are color-coded next to Value.
  - Players outside the pool are greyed out, with the reason.
- **Player detail.** Tap a row to see:
  - projection by source as bars, including sources with no projection for the player;
  - consensus, spread and range;
  - floor and volatility;
  - a component table (raw value, z, weight, contribution);
  - status from each source.
- **Refresh.** Opens the workflow's *Run workflow* page. Optionally, paste a fine-grained token
  (*Actions: Read and write*, this repo only) under *One-click refresh*. It's stored only in
  that browser's localStorage and triggers the workflow directly.

### Run locally

```bash
cd web
npm ci
npm run dev            # http://localhost:5173, uses the bundled sample data in public/data
npm test && npm run build
```

To view real data locally, run the pipeline with `--out ../web/public/data`.

### Deploy to GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. `pipeline.yml` has a `deploy` job. It runs after every pipeline run, copies `latest/` from
   the `data` branch into the build, and publishes `web/dist`. Pushes to `main` that touch `web/`
   redeploy with the current data.
3. The site is at `https://<user>.github.io/<repo>/`. It's `noindex`, but it's public if the
   repo is. If you want it private, see the Cloudflare option in the troubleshooting table.

---

**Glossary tab.** Plain-language definitions of every column, setting, model and backtest measure
on the site, with search (`web/src/components/Glossary.tsx`). Numbers that live in code (preset
weights, simulation count, pool minimums) are read from it, so the glossary stays in step.

## Stage 4 — lineup optimizer

The **Lineups** tab has two modes. Both run in the browser: an integer program solved with
GLPK compiled to WebAssembly (`glpk.js`, loaded only when you open the tab) builds candidate
lineups, and a simulation judges them. They re-run automatically, in a second or two, whenever
settings, locks or excludes change.

| mode | picks the lineup with the highest | candidates it compares |
|---|---|---|
| **Safest (cash)** | chance of reaching the **target score** (default 125; set it to your contest's usual cash line) | `proj − λσ` for λ = 0, 0.35, 0.7, 1.0, each with and without *spread* (≤2 offensive players per team, no QB with his own WR/TE), best 3 of each |
| **Highest potential** | **90th-percentile** score (the lineup's ceiling) | for each team in the 4 highest-total games: its QB + ≥2 of his WR/TE + ≥1 RB/WR/TE from the opponent, scored `proj + κσ + 0.25·TD points + 0.15·(team total − slate average)` for κ = 0.5, 1.0, best 2 of each |

**Simulation** (`web/src/lib/sim.ts`). 2,000 simulated slates. Each player's score is lognormal
with mean = projection and spread = σ (right-skewed: a bad game stays near zero, a two-touchdown
game can double the projection). Players are linked through shared random factors: a game
factor (both offenses), a team passing factor (QB, WR, TE), a team rushing factor (RB), a
game-script factor (RB, own DST) and the opposing offense (a DST suffers when the offense it faces
does well). That gives roughly QB–WR 0.38, QB–TE 0.32, same-team WRs 0.29, QB–opposing WR 0.09,
RB–own DST 0.12, DST–opposing QB −0.33. So a lineup's floor and ceiling depend on how its players
move together, not on adding up individual floors: stacking raises the ceiling and widens the
range; spreading across games narrows it. These correlations are sensible defaults, not yet fitted
to our own data. The simulation is seeded, so the same slate always gives the same lineups.

**Touchdown points.** `td_pts` in players.json is each player's expected touchdown points
(4 per passing TD, 6 per rushing/receiving TD), averaged over the stat-line sources.

Each lineup card shows the projection, the simulated floor (10th percentile), median, ceiling
(90th percentile) and, for Safest, the chance of reaching the target, plus how the lineup was
found (e.g. `stack CAR + bring-back DET (game total 51.5)`).

```
integer program (both modes):
maximize   Σ scoreᵢ·xᵢ               scoreᵢ set by the candidate (see above)
subject to Σ salaryᵢ·xᵢ ≤ 50,000      (≥ min salary if set)
           9 players; QB = 1; DST = 1; RB 2–3; WR 3–4; TE 1–2   (one FLEX)
           locked xᵢ = 1; excluded players removed; D/O/IR removed; Q optional
           optional: no offensive player facing your DST
           optional (Safest): QB plus at least one of his own WR/TE
           stack / spread constraints per candidate
           alternatives: overlap with earlier lineups ≤ 9 − (min. different players)
```

- **Lock / Exclude** buttons appear in the player table and in each lineup. They're saved per
  slate (by draft group), so last week's locks don't carry over. A locked QB limits Highest
  potential to stacks of his team.
- **Alternatives.** Lineups 2 to N are the next-best candidates by the mode's measure that differ
  from every earlier pick by at least *min. different players*. Players not in the best lineup are
  highlighted.
- **FLEX assignment.** The FLEX spot goes to the eligible player with the **latest kickoff**,
  which keeps late-swap flexibility.
- **Use N as target total T.** One click sets the value model's T to the best lineup's
  projection.
- **Backtest.** The Backtest tab builds both modes for every graded week and scores them against
  what actually happened.

Tests: `web/src/lib/optimizer.test.ts` checks the solver against brute force on a small pool, and
checks locks, excludes, the DST rule, stacking, minimum salary, alternatives, FLEX assignment and
infeasible settings. `web/src/lib/strategies.test.ts` checks the simulation (means, skew,
correlations, determinism) and both modes (ranking, stack structure, locks and excludes, and that
Highest potential has a higher ceiling and Safest a higher floor).

## Backtest

Each week's projections are graded against what players actually scored, so changes to the
model can be measured instead of guessed. Code: `pipeline/dfs/backtest.py` (actuals and
projection/floor metrics) and `web/src/lib/backtest.ts` (value ranking and lineups).

**Snapshot.** Every run rewrites `history/<season>/week<NN>/players.json` on the data branch, but
a player's row **freezes at his kickoff**: later runs (Sunday afternoon, Monday) keep the last
pre-kickoff projection, so the snapshot is what the site showed when lineups locked. Weeks saved
before this feature (2026 week 3) were last written mid-Sunday, so a few early-game rows there
reflect post-kickoff source updates.

**Actuals.** Once every game on a week's slate has a final score and nflverse has published that
week's stats (usually by Tuesday), the pipeline writes `history/.../actuals.json` with each
player's actual DraftKings points: offense from nflverse weekly player stats, DSTs from nflverse
weekly team stats (sacks, interceptions, fumble recoveries, defensive/return TDs, safeties,
blocked kicks) plus the opponent's final score for points allowed. Two approximations: points
allowed use the opponent's final score, which can differ from DraftKings' figure when the opponent
scored on defense or special teams; and a player with no stat line counts as 0 and "did not play".
Weeks are re-graded on later runs to pick up stat corrections. The health bar's "Team stats"
chip carries one line per graded week.

**The Backtest tab** (all graded weeks, or one week):

| section | what it measures | what "good" looks like |
|---|---|---|
| Projection accuracy | mean absolute error and bias (actual − projected) per source and position, over players in the value pool at kickoff who played; each source is compared with the consensus on the same players | consensus MAE about 5–6 points; a source in bold beats the consensus |
| Floor check | share of players who scored below their floor | about 20% (the floor is a 20th percentile); much higher means floors are too high |
| Value ranking | for each weight preset and your current weights: rank correlation between value and actual points above salary pace (`actual − salary × T/50,000`), and with actual points per $1K, within position; and how often each position's top 3 by value reached salary pace | higher is better; compare presets rather than reading one number |
| Lineups | the best lineup each week under your optimizer rules (max projection and floor-weighted), its actual score against an editable cash line, and the hindsight-best lineup | cashing most weeks |
| Did not play | players in the pool at kickoff who recorded no stats | short |

**Backfilling past weeks.** Weeks from before the backtest existed can be rebuilt from a DraftKings
contest you entered that week: Actions → pipeline → Run workflow, and put the contest IDs (the
number in the contest's address, e.g. `draftkings.com/contest/gamecenter/195541057`) in
"Backfill past weeks", comma-separated. A slate ID also works as `dg:<id>`. Locally:
`python -m dfs.backfill --data-dir ../data 195541057 195736168`. For each contest the backfill finds the
contest's slate, downloads its salaries, requests that week's projections from each source, and
writes `history/<season>/week<NN>/` (plus a `sources.json` showing what each source returned),
then regrades everything. Backfilled weeks are labelled on the Backtest tab and are less reliable than
live ones: that week's injury news can't be recovered, and the projections are whatever each source
serves for the week now. CBS is left out of backfills because it serves the current week's projections for any past week. DraftKings' salary file for a finished slate has no game details, so the week is found from the matchups and kickoffs come from the schedule (`dg:<id>:w<N>` sets the week if that fails). A week with a live snapshot is never overwritten (`--force` to override).
This only works while DraftKings still serves the old slate's salaries.

One week is a small sample (a player's weekly score varies by ±50% or more). Wait for three or more
graded weeks before changing weights, `T`, `z` or λ on the strength of these numbers.

---

## Data sources

The containers used to build this could not reach these hosts, so every adapter is tested
against generated fixtures in each source's format. Run `python -m dfs.build --dry-run` (or the
workflow) to see live status.

| source | provides | access | terms-of-service risk | break risk |
|---|---|---|---|---|
| DraftKings `lobby/getcontests` + `draftgroups/v1/.../draftables` | salaries, games, DK status | unofficial public JSON | medium (DK terms bar automated access; ~2 requests/run) | low–medium |
| DraftKings `DKSalaries.csv` | salaries | official export (you download it) | none | none |
| Sleeper `players/nfl`, `state/nfl` | injuries, IDs, week | unofficial but documented read API | low | low |
| Sleeper `projections/nfl/{season}/{week}` | stat projections incl. DST | undocumented (used by Sleeper's web app) | low–medium | medium |
| ESPN `lm-api-reads.fantasy.espn.com … kona_player_info` | stat projections (no DST) | unofficial; needs an `X-Fantasy-Filter` with a limit **and** a sort | medium | medium (host has moved before) |
| CBS projections pages | stat projections (offense) | **scraped HTML** | medium–high | medium–high |
| nflverse / DynastyProcess CSVs | ID crosswalk, schedule, Vegas lines, weekly stats | official open data on GitHub | none | very low |
| Vegas DST model | DST projection from implied totals | derived | none | none |
| NFL.com, Fantasy Points, RotoBaller, Fantasy Six Pack, DraftSharks, Fantasy Knockout, Yahoo, PFF, BettingPros | projections (stat lines or points totals) | **scraped, auto-discovered** (below) | varies; most sites' terms restrict scraping | high: layouts change; several are paywalled or login-only |

Turn any source off in `config.toml → [sources]`. Consensus weights are in `[source_weights]`.

### Projection websites

The projection websites have no API, and their pages couldn't be inspected in advance, so
they share one format-agnostic scraper (`pipeline/dfs/sources/websites.py`).

**How each site is read:**
1. It reads the site's `robots.txt` and skips anything it disallows. It pauses 1 second between
   requests, visits at most 10 pages per site, and gives each site 90 seconds.
2. It starts from a few seed URLs plus links on the homepage that mention projections. Weekly,
   NFL and PPR links rank first. Season-long, draft, dynasty and other-sport links are skipped
   or ranked last.
3. If a page looks like a bot check or block page, it stops visiting that site for the run.
   It records a text sample of any page without data in `probe.json`.
4. It follows per-position sub-pages (QB/RB/WR/TE/DST). When a page has no numbers (they load
   with JavaScript), it follows data addresses (JSON/API/CSV) and embedded frames that the page
   mentions and that relate to projections. It only makes plain GET requests.
4. On each page it reads projection rows from HTML tables or from JSON embedded in the page
   (for example Next.js `__NEXT_DATA__` or `window.__STATE__`). It maps columns by name: player,
   team, position, stat line, or a fantasy-points column.
5. Stat lines are rescored with DraftKings rules.
6. Pages whose numbers look like season totals are rejected.

**Sites that only publish a points total:** those totals use the site's own scoring, which misses
DraftKings' yardage bonuses. They're scaled per position against the average of the sources
rescored from stat lines, using the median ratio clamped to 0.8–1.25. The factors appear in each
source's notes and in `sources.json → match_report.calibration`.

**What to expect:**

First live run (week 3, 2026), from GitHub Actions:

| site | result | default |
|---|---|---|
| Fantasy Six Pack | worked on run 10 (weekly stat lines, rescored with DraftKings rules); the next run got near-empty pages, likely a bot check. Crawling now stops at the first such page. Switched off. | off |
| NFL.com | `fantasy.nfl.com/research/projections` now returns a "Fantasy News" page with no tables or data | off |
| Fantasy Points | `fantasypoints.com/nfl/projections` loads, but has no numbers or data address in the page (likely subscriber-only) | off |
| DraftSharks | homepage links no projection pages; projections are mostly for subscribers | off |
| RotoBaller | projections table is empty; the page's data is ad settings; numbers load for Premium users | off |
| Fantasy Knockout | homepage links no projection pages | off |
| Yahoo | projections only inside a logged-in league | off |
| PFF | PFF+ subscription; the page carries no data without it | off |
| BettingPros | no NFL projections page found; the guessed URL returned 404 | off |

Switch a site back on in `config.toml → [sources]` to retry it.
Logins and paywalls are **not** bypassed.

**Diagnostics.** Every run writes `latest/probe.json` on the `data` branch. For each site it lists
every page tried, its status, the tables and JSON found, and the columns used. A site that
fails shows a one-line page summary in its error on the site's source panel. Use it to add
seed URLs or column names in `websites.py`.

**Uploading projections.** If you have projection exports (from a subscription, or any site's
CSV download), commit them to a `projections/` folder at the top level of the repo:

```
projections/<source>_week<N>_<part>.csv
```

- **`<source>`:** any lowercase name. A scraped site's name (`pff`, `nflcom`, …) replaces that
  site's scraping for the week. A new name (for example `fantasypros`) becomes its own source,
  labelled "(uploaded)".
- **`week<N>`:** the NFL week the file is for. Files for other weeks are ignored. Leave it out
  (`<source>.csv`, `<source>_<part>.csv`) to use a file every week until you delete it.
- **`<part>`:** optional. Use it to split one source across several files, which are combined.
  A position in the part (`qb`, `rb`, `wr`, `te`, `dst`) is used when the file has no position
  column.

Example: FantasyPros' three exports for week 3:

```
projections/fantasypros_week3_qb.csv
projections/fantasypros_week3_flex.csv
projections/fantasypros_week3_dst.csv
```

Columns are detected by name. FantasyPros' repeated `YDS`/`TDS` headers are read in order as
passing, rushing and receiving, based on the `ATT CMP` and `REC` columns around them. Stat lines
are rescored with DraftKings rules. Uploads are used even while that site's scraping is switched
off.

---

## Troubleshooting

| symptom | fix |
|---|---|
| A source is `failed` with `covers 12% of relevant slate players` | The site changed its format or served a block page. Look at the adapter in `pipeline/dfs/sources/`, then run `--dry-run` locally. |
| A player is missing one source's projection | Look at `sources.json → match_report.unmatched`. Add a nickname to `NAME_ALIASES` in `pipeline/dfs/names.py`. |
| Wrong week | Set `[slate] week = N` in `config.toml` (0 = auto). |
| Wrong draft group | Set `[slate] draft_group_id` (from the URL of a DraftKings contest's lineup page). |
| Site shows "Sample data" | The deploy found no `latest/players.json` on the `data` branch yet. Run the pipeline workflow. |
| Want the site private | GitHub Pages on a free plan is public. Free alternative: Cloudflare Pages with Cloudflare Access. Build with `npm run build` and deploy `web/dist` (for example with `cloudflare/wrangler-action`). |
