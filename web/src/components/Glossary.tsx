import { useMemo, useState } from 'react';
import { SIMS } from '../lib/sim';
import { STACK_GAMES } from '../lib/strategies';
import { DEFAULT_SETTINGS, PRESETS } from '../lib/value';
import type { Slate } from '../types';

interface Term {
  term: string;
  aka?: string; // how it appears on the site, if different
  def: string;
  example?: string;
}

interface Section {
  id: string;
  title: string;
  intro?: string;
  terms: Term[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function sections(slate: Slate | null): Section[] {
  const pool = slate?.pool_min_projection;
  const poolText = pool
    ? `QB ${pool.QB}, RB ${pool.RB}, WR ${pool.WR}, TE ${pool.TE}, DST ${pool.DST} projected points`
    : 'a minimum projection for each position';
  const presets = Object.entries(PRESETS)
    .map(([name, w]) => `${name}: efficiency ${pct(w.efficiency)}, positional ${pct(w.positional)}, budget ${pct(w.budget)}, reliability ${pct(w.reliability)}`)
    .join('. ');
  return [
    {
      id: 'basics',
      title: 'The basics',
      intro: 'What the site is for, and the DraftKings rules everything else is built on.',
      terms: [
        { term: 'Daily fantasy (DFS)', def: 'You pick a fresh team of real NFL players for one week. They score points for what they do on the field (yards, catches, touchdowns), and your team’s total decides whether you win.' },
        { term: 'Classic contest', def: 'The standard DraftKings NFL format: 9 players (1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 DST) and a $50,000 salary cap.' },
        { term: 'Cash game', aka: 'Double-up, 50/50', def: 'A contest where roughly the top half of entries win (often doubling their entry). You don’t need the best lineup, just one that beats about half the field. That’s why this site cares so much about a safe, high floor.' },
        { term: 'Salary', def: 'The DraftKings price of a player. Your 9 players must fit under $50,000 in total, so a star at $9,000 means saving money elsewhere.' },
        { term: 'FLEX', def: 'One extra roster spot that can be an RB, WR or TE. The site puts the player with the latest kickoff there, so you have the most room to swap if late news breaks.' },
        { term: 'DST', def: 'Defense/special teams: you pick a whole team’s defense. It scores for sacks, interceptions, fumble recoveries, defensive and return touchdowns, safeties and blocked kicks, and for holding the other team to few points.' },
        { term: 'DraftKings scoring (PPR)', def: '1 point per catch (that’s the “PPR”, points per reception), 1 per 10 rushing or receiving yards, 1 per 25 passing yards, 6 per rushing/receiving touchdown, 4 per passing touchdown, −1 per interception thrown or fumble lost, and a 3-point bonus for a 300-yard passing, 100-yard rushing or 100-yard receiving game. DST: 1 per sack, 2 per interception or fumble recovery, 6 per touchdown, 2 per safety or blocked kick, plus 10 points for a shutout sliding down to −4 for allowing 35 or more.' },
        { term: 'Slate', def: 'The set of games a contest covers. This site uses DraftKings’ Sunday–Monday slate: every Sunday game plus Sunday night and Monday night.' },
        { term: 'Lock', def: 'Each player is locked when his game kicks off; you can’t swap him out after that.' },
        { term: 'Late game', aka: 'late', def: `A game kicking off at ${slate?.late_game_hour ?? 16}:00 local time or later. Good to know for swapping players after early-game news.` },
      ],
    },
    {
      id: 'table',
      title: 'Player table columns',
      intro: 'Each column of the Players tab, left to right. Click a player for the full breakdown.',
      terms: [
        { term: 'Value', def: 'The site’s overall rating of how good a pick a player is for cash games, compared with others at his position. 0 is average for the position; +1 is clearly better than average; +2 or more is a standout. It blends the four value components below using the weights you choose.', example: 'A WR with Value +1.6 is one of the best WR buys on the slate; −0.5 means you’re paying more than his outlook justifies.' },
        { term: 'Proj', aka: 'Projection', def: 'How many DraftKings points we expect the player to score: the average of several expert projection sources (the “consensus”).' },
        { term: '± spread', def: 'How much the sources disagree. ±0.5 means they all say about the same; ±4 means one source is much higher or lower than another, so treat the projection with more caution.' },
        { term: 'Floor', def: 'A bad-but-realistic game for this player: about 4 times in 5 he should score at least this many points. It comes from how much his scoring has jumped around in past games.' },
        { term: 'Pts/$K', def: 'Projected points for every $1,000 of salary. The classic “bang for your buck” number. 3.0 (3x) is a common benchmark in cash games.', example: 'A $5,000 player projected for 16 points is 3.2 pts/$K.' },
        { term: 'Eff, PosV, Budg, Rel', def: 'The four value components (Efficiency, Positional value, Budget impact, Reliability), each shown as a score versus others at the position. See “The value model” below.' },
        { term: 'Src', def: 'How many projection sources cover this player. More sources means a sturdier projection.' },
        { term: 'Status', def: 'Injury designation: Q = Questionable (may play), D = Doubtful (unlikely to play), OUT = will not play, IR = on injured reserve. DraftKings’ own status wins; if Sleeper marks a player Doubtful or Out while DraftKings still says active, the site takes the more cautious one and flags the conflict.' },
        { term: 'Team total', aka: 'Implied total', def: 'How many points sportsbooks expect the player’s team to score, worked out from the betting spread and over/under. High team totals mean more touchdown chances.' },
        { term: 'Value pool', def: `The players the value model compares with each other: those with a projection of at least ${poolText} who aren’t Doubtful, Out or on IR. Others still show in the table but aren’t ranked.` },
        { term: 'Position rank', aka: 'e.g. WR3', def: 'Where a player’s Value ranks among players at his position in the value pool.' },
      ],
    },
    {
      id: 'projections',
      title: 'Projections and data',
      intro: 'Where the numbers come from.',
      terms: [
        { term: 'Projection source', def: 'An outside site that forecasts player stats: Sleeper, ESPN, CBS, the site’s own Vegas model for defenses, and any projections you upload (e.g. FantasyPros). The colored chips at the top show each one’s health.' },
        { term: 'Consensus', def: 'The average of all available sources for a player. Each source counts equally except the Vegas DST model, which counts half because it’s a simple model.' },
        { term: 'Rescoring to DraftKings rules', def: 'Most sources publish a stat line (yards, catches, touchdowns). We score that line with DraftKings’ exact rules, including the chance of hitting a 100- or 300-yard bonus. Sources that only give a points total are adjusted to the DraftKings scale using the stat-line sources.' },
        { term: 'Vegas DST model', def: 'A defense projection built from betting lines: defenses facing teams expected to score few points, and teams that are big favorites, project better.' },
        { term: 'Touchdown points', aka: 'TD points', def: 'How many of a player’s projected points are expected to come from touchdowns (4 per passing TD, 6 per rushing or receiving TD). Touchdowns are the most unpredictable part of scoring, so a high share means more boom-or-bust.' },
        { term: 'Source health', aka: 'ok / stale / failed / disabled', def: 'ok = fresh data this run. stale = the source failed this time, so its last good copy (up to 3 days old) is used. failed = no usable data. disabled = switched off. A failure opens an alert on GitHub automatically.' },
        { term: 'Coverage', def: 'The share of the slate’s fantasy-relevant players a source covers. A source covering too few is treated as failed, so it can’t quietly skew the consensus.' },
      ],
    },
    {
      id: 'value',
      title: 'The value model',
      intro: 'How the Value score is built. Every part compares a player only with others at his position on this slate.',
      terms: [
        { term: 'Score versus the position', aka: 'z-score', def: 'Each component is turned into “how far above or below the typical player at this position”, measured in a common unit so different components can be added up. 0 = typical, +1 = clearly above, −1 = clearly below. Capped at ±3 so one extreme number can’t dominate.' },
        { term: 'Efficiency', aka: 'Eff', def: 'Points per $1,000 of salary, compared with the position. Rewards cheap players who project well.' },
        { term: 'Positional value', aka: 'PosV', def: 'How many more points a player projects than what his salary “should” buy at his position on this slate. We draw the typical salary-to-points line for the position and measure how far above it he sits. This avoids over-rewarding the cheapest players the way raw points-per-dollar does.' },
        { term: 'Budget impact', aka: 'Budg', def: 'Points above the pace a winning lineup needs. If a lineup needs T points from $50,000, every $1,000 should bring T/50 points; a player beating that pace by a lot helps you most. Rewards players who add big chunks of points.' },
        { term: 'Reliability', aka: 'Rel', def: 'How trustworthy the projection is: 70% for how high his floor is compared with his projection (steady players), 30% for how much the sources agree, minus a penalty if he’s Questionable. The backtest showed a player’s own week-to-week steadiness predicts busts much better than source agreement does, so it counts more.' },
        { term: 'Weights', def: 'How much each component counts in the Value score, set with the sliders under “Value weights”. They’re relative: 2-2-1-1 is the same as 0.33-0.33-0.17-0.17.' },
        { term: 'Presets', def: `Ready-made weight settings. ${presets}.` },
        { term: 'Target total (T)', def: `The score a winning cash lineup typically needs, in DraftKings points (default ${DEFAULT_SETTINGS.targetTotal}). It sets the pace used by Budget impact. The Lineups tab can set it to the best lineup’s projection in one click.` },
        { term: 'Q penalty', def: `How much a Questionable tag lowers a player’s Reliability (default ${DEFAULT_SETTINGS.qPenalty}). “Exclude Q players” removes them from the value pool entirely.` },
      ],
    },
    {
      id: 'floor',
      title: 'Floor, ceiling and volatility',
      terms: [
        { term: 'Volatility', aka: 'CV', def: 'How much a player’s scoring swings from week to week, compared with his average, measured from his past games (this season and last). A steady possession receiver might be 40%; a deep-threat receiver or touchdown-dependent tight end can be 70% or more.' },
        { term: 'Position average volatility', def: 'Players with few past games are pulled toward their position’s typical volatility (QB 40%, RB 55%, WR 62%, TE 68%, DST 80%) so a couple of lucky or unlucky games don’t mislead. The more games he has, the more his own history counts.' },
        { term: 'Floor (player)', def: 'Projection minus a cushion based on volatility: roughly the score he beats 4 times out of 5 (the 20th percentile). The cushion is a little wider for running backs (15%), receivers, tight ends and defenses (6–8%), because the backtest showed too many of them finishing below their floor.' },
        { term: 'Ceiling', def: 'The opposite of the floor: a great-but-realistic game. On the Lineups tab, a lineup’s ceiling is the score it beats only 1 time in 10 (the 90th percentile).' },
        { term: 'Percentile', def: 'Where an outcome ranks out of 100 tries. 10th percentile = only 10 of 100 outcomes are lower (a bad day); 50th = the middle (median); 90th = only 10 of 100 are higher (a great day).' },
      ],
    },
    {
      id: 'lineups',
      title: 'Lineups and the two modes',
      intro: 'The Lineups tab builds full 9-player lineups under the salary cap. Choose the mode that fits your contest.',
      terms: [
        { term: 'Safest (cash)', def: 'Finds the lineup with the best chance of reaching your target score. It looks at the lineup as a whole: players whose good and bad days tend to happen together make a lineup riskier, even if each one looks safe alone. Best for double-ups and 50/50s.' },
        { term: 'Highest potential', def: `Finds the lineup with the highest ceiling. Each lineup is built around a stack from one of the ${STACK_GAMES} highest-scoring-expected games, and players likely to score touchdowns get extra credit. Best for tournaments, where you need a big score to finish near the top.` },
        { term: 'Target score', def: 'The score you’re aiming for in Safest mode, usually your contest’s typical cash line (default 125).' },
        { term: 'Chance of target', aka: 'e.g. 76% chance of 125+', def: 'How often the lineup reached the target score in the simulated games.' },
        { term: 'Simulation', def: `The site plays out this week’s games ${SIMS.toLocaleString()} times on the computer. Each time, every player gets a random but realistic score based on his projection and volatility, and players in the same game move together the way they do in real life. Lineups are then judged on all those results instead of a single guess.` },
        { term: 'Players moving together', aka: 'correlation', def: 'Some players’ results are linked. When a quarterback has a big game, his receivers usually do too; when an offense struggles, the defense facing it scores well. But receivers on the same team share a limited number of targets, so one’s big day often means a quieter day for another, and two running backs on one team split the work. The simulation uses these links as measured in our own backtest. The two offenses in the same game turned out to be barely linked.' },
        { term: 'Bust game', def: 'A game where a player scores almost nothing, from an early injury, a benching or simply no targets. It happened in about 1 in 10 games for running backs, receivers and tight ends in our backtest, so the simulation includes that chance (3% for quarterbacks). Defenses can also score zero or negative points.' },
        { term: 'Stack', def: 'Picking a quarterback together with his own pass-catchers (WR or TE), so one big passing game counts several times in your lineup. It raises the ceiling and the risk.' },
        { term: 'Bring-back', def: 'A player from the stacked team’s opponent. If the game becomes a shootout, both sides score, so you get points from both.' },
        { term: 'Game total', aka: 'Over/under', def: 'How many combined points sportsbooks expect in a game. Higher totals mean more scoring for fantasy players.' },
        { term: 'Spreading out', def: 'Safest mode also tries lineups with no more than 2 offensive players from any team and no quarterback paired with his own receivers, which keeps one bad offensive day from sinking several of your players.' },
        { term: 'Candidate lineups', def: 'The optimizer first builds many good lineups using different strategies, then the simulation scores each one and keeps the best for your chosen mode.' },
        { term: 'Floor / Median / Ceiling (lineup)', def: 'From the simulation: the floor is the score the lineup beats 9 times in 10 (10th percentile), the median is the middle outcome, and the ceiling is what it reaches 1 time in 10 (90th percentile).' },
        { term: 'Lock / Excl', def: 'Lock forces a player into every lineup; Excl keeps him out. Saved for this slate only.' },
        { term: 'Alternatives', aka: 'Min. different players', def: 'The next-best lineups after the best one. Each differs from every earlier lineup by at least this many players. Swapped-in players are highlighted.' },
        { term: 'Min. salary', def: 'Forces lineups to spend at least this much of the $50,000 cap.' },
        { term: 'No offense vs my DST', def: 'Never pairs your defense with players from the offense it’s facing, since a good game for one usually means a bad game for the other.' },
        { term: 'QB + own WR/TE', def: 'A Safest-mode option requiring your quarterback to have at least one of his own receivers in the lineup. Highest potential always stacks.' },
        { term: 'Allow Q players', def: 'Whether Questionable players can be used in lineups.' },
      ],
    },
    {
      id: 'panel',
      title: 'Player panel',
      intro: 'Click any player (Players or Lineups tab) for the full picture.',
      terms: [
        { term: 'Player summary', def: 'The short, tongue-in-cheek write-up at the top of the panel, in the spirit of late-90s highlight shows. It’s generated from the player’s own numbers (value, Vegas totals, matchup, recent form, usage, injury status), so every claim in it is backed by the stats below. Always 50 words or less.' },
        { term: 'Slate rank', def: 'Where a team or game sits among this week’s slate: “team total 27.5, 2nd of 26 teams” means only one team on the slate is expected to score more. Game totals are ranked the same way among the slate’s games.' },
        { term: 'Share of game points', def: 'His team’s expected points divided by the game total: how much of the expected scoring goes to his side.' },
        { term: 'Bad day / Great day', def: 'From the simulation: the score he beats 9 times in 10 (10th percentile) and the score he reaches only 1 time in 10 (90th percentile). The Floor in the top row is the pipeline’s slightly less pessimistic 20th percentile.' },
      ],
    },
    {
      id: 'compare',
      title: 'Compare tab',
      intro: 'Put up to three players side by side and see who is most likely to score the most.',
      terms: [
        { term: 'Chance to score the most', def: `How often each player outscored the others across ${SIMS.toLocaleString()} simulated games. It uses the same simulation as the Lineups tab, so teammates and opponents keep their real-world links. The three numbers always add up to 100%.` },
        { term: 'Head to head', def: 'For each pair, how often one outscores the other in the simulated games.' },
        { term: 'Most points per $1K', def: 'How often each player gave the most points per $1,000 of salary: useful when the pricier player isn’t worth the extra money.' },
        { term: 'Reaches salary pace', def: 'The chance a player scores enough to justify his salary at your target total T (for example 18 points from a $6,000 player when T = 150).' },
        { term: 'Opponent vs position', aka: 'Matchup', def: 'How many DraftKings points this week’s opponent has given up per game to the player’s position this season, ranked from easiest (1st) to toughest. Early in the season last year’s games are included. For a defense, it’s how many points the opposing offense scores per game (1st = scores the fewest).' },
        { term: 'Game log', aka: 'Recent games', def: 'Each earlier game this season: the opponent, our projection before kickoff, what he actually scored, and his stat line. In the chart, columns are actual points and the dark line is our projection. “vs our projection” is the average difference.' },
        { term: 'Target share', def: 'The share of his team’s passes thrown his way. Steady target share is one of the best signs of a reliable receiver.' },
        { term: 'From touchdowns', def: 'The share of his projection expected to come from touchdowns. Higher means more boom-or-bust.' },
      ],
    },
    {
      id: 'backtest',
      title: 'Backtest',
      intro: 'Grading past weeks: what we projected before kickoff compared with what actually happened.',
      terms: [
        { term: 'Graded week', def: 'A finished week whose players’ actual DraftKings points have been collected (usually by Tuesday, once all games are final and the stats are published).' },
        { term: 'Actual', def: 'The DraftKings points a player really scored, calculated from official stats.' },
        { term: 'Average miss', aka: 'MAE', def: 'On average, how many points the projection was off by, ignoring whether it was too high or too low. Around 5–6 points per player is typical for good fantasy projections.' },
        { term: 'Bias', def: 'Whether projections ran too high or too low on average: actual minus projected. +1.5 means players scored 1.5 more than projected (projections too low); −1.5 means projections were too high.' },
        { term: 'Floor check', def: 'How often players scored below their floor. It should be about 1 in 5 (20%). Much more means floors are set too high; much less means they’re too cautious.' },
        { term: 'Rank correlation', def: 'How well the Value ranking ordered players compared with how they actually did, from −1 (exactly backwards) through 0 (no better than random) to +1 (perfect order). In fantasy football, even 0.2–0.3 is useful.' },
        { term: 'Salary pace', def: 'The points a player needed to score to justify his salary, at the pace of your target total T. With T = 150, that’s 3 points per $1,000 of salary (a $6,000 player needs 18).' },
        { term: 'Top-3 hit pace', def: 'How often each position’s top 3 players by Value reached salary pace. Higher means the Value ranking found real bargains.' },
        { term: 'Cash line', def: 'The score you assume was needed to win a cash game that week (editable). Each lineup is marked cashed or not against it.' },
        { term: 'Hindsight best', def: 'The best possible lineup using what players actually scored: a ceiling no one could have known in advance, shown for comparison.' },
        { term: 'In the pool but did not play', aka: 'DNP', def: 'Players in the value pool at kickoff who recorded no stats, usually late scratches. They count as 0 points.' },
        { term: 'Backfilled', def: 'A week rebuilt after the fact (weeks 1–2 this season) rather than saved live. Injury news from that week isn’t available and only some sources could provide old projections, so treat those weeks as rougher.' },
      ],
    },
  ];
}

export function Glossary({ slate }: { slate: Slate | null }) {
  const [q, setQ] = useState('');
  const all = useMemo(() => sections(slate), [slate]);
  const needle = q.trim().toLowerCase();
  const shown = all
    .map((s) => ({
      ...s,
      terms: needle
        ? s.terms.filter((t) => [t.term, t.aka ?? '', t.def, t.example ?? ''].join(' ').toLowerCase().includes(needle))
        : s.terms,
    }))
    .filter((s) => s.terms.length);
  return (
    <section className="glossary">
      <p className="muted">Every number, setting and model on this site, in plain football-fan terms.</p>
      <input type="search" className="search" placeholder="Search the glossary (e.g. floor, stack, value)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the glossary" />
      {!needle && (
        <nav className="glossary-toc">
          {all.map((s) => (
            <a key={s.id} href={`#g-${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
      )}
      {shown.length === 0 && <p className="muted">No terms match “{q}”.</p>}
      {shown.map((s) => (
        <div key={s.id} id={`g-${s.id}`} className="glossary-section">
          <h3>{s.title}</h3>
          {s.intro && !needle && <p className="muted small">{s.intro}</p>}
          <dl>
            {s.terms.map((t) => (
              <div key={t.term} className="glossary-term">
                <dt>
                  {t.term}
                  {t.aka && <span className="muted"> · {t.aka}</span>}
                </dt>
                <dd>
                  {t.def}
                  {t.example && <span className="glossary-example">Example: {t.example}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
