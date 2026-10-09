// Shapes of the JSON written by pipeline/dfs/build.py.

export type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'DST';
export type Status = 'ACTIVE' | 'Q' | 'D' | 'O' | 'IR';

export interface Player {
  id: string;
  name: string;
  pos: Pos;
  team: string;
  opp: string | null;
  home: boolean | null;
  game: string | null;
  kickoff: string | null;
  late: boolean;
  salary: number;
  status: Status;
  status_detail: Record<string, string>;
  status_conflict: boolean;
  projections: Record<string, number>;
  n_sources: number;
  missing_sources: string[];
  proj: number | null;
  proj_sd: number | null;
  td_pts?: number | null; // expected touchdown points (stat-line sources); absent in older data
  proj_min: number | null;
  proj_max: number | null;
  team_total: number | null;
  opp_total: number | null;
  match: Record<string, string>;
  floor: number | null;
  sigma: number | null;
  cv: number | null;
  hist_games: number;
  hist_mean: number | null;
  in_pool: boolean;
  gsis_id?: string | null;
  log?: GameLogEntry[]; // this season's games before this week, newest first (pipeline/dfs/context.py)
  season_stats?: SeasonStats | null;
  matchup?: Matchup | null;
}

export interface GameLogEntry {
  week: number;
  opp: string | null;
  actual: number;
  proj: number | null; // our pre-kickoff consensus that week
  dnp: boolean;
  line: Partial<Record<'pass_yd' | 'pass_td' | 'int' | 'car' | 'rush_yd' | 'rush_td' | 'tgt' | 'rec' | 'rec_yd' | 'rec_td' | 'tgt_share', number>>;
}

export interface SeasonStats {
  games: number;
  avg: number;
  tgt: number;
  car: number;
  tgt_share: number | null;
  games_20: number;
}

export interface Matchup {
  kind: 'defense' | 'offense'; // defense: points the opponent allows to this position; offense (DST): points the opponent scores
  allowed: number;
  rank: number; // 1 = best matchup
  pos_avg: number;
  games: number;
  teams: number;
}

export interface Game {
  game: string;
  away: string;
  home: string;
  kickoff: string | null;
  total?: number | null;
  spread?: number | null;
  implied?: Record<string, number> | null;
}

export interface Slate {
  schema_version: number;
  generated_at: string;
  sample: boolean;
  season: number;
  week: number;
  slate_date: string | null;
  draft_group_id: number | null;
  slate_label?: string | null; // e.g. "(Sun-Mon)", "Main", "Uploaded CSV"
  games: Game[];
  byes: string[];
  off_slate_teams: string[];
  salary_cap: number;
  pool_min_projection: Record<Pos, number>;
  floor_z: number;
  late_game_hour?: number;
  timezone: string;
  notes: string[];
}

export interface SourceHealth {
  name: string;
  label: string;
  kind: 'salaries' | 'projections' | 'status' | 'reference';
  access: string;
  status: 'ok' | 'stale' | 'failed' | 'disabled';
  fetched_at: string | null;
  rows: number;
  coverage: number | null;
  error: string | null;
  stale_hours: number | null;
  notes: string[];
}

export interface SourcesReport {
  generated_at: string;
  sources: SourceHealth[];
  failed: string[];
  match_report: {
    unmatched?: Record<string, { name: string; pos: string; team: string; points: number }[]>;
    no_projection?: { name: string; pos: string; team: string; salary: number }[];
  };
  notes: string[];
}

// latest/backtest.json, written by pipeline/dfs/backtest.py

export interface BacktestRow
  extends Omit<Player, 'status_detail' | 'status_conflict' | 'missing_sources' | 'match'> {
  actual: number; // DraftKings points scored
  played: boolean; // false: no stat line (inactive, or never touched the ball)
}

export interface AccuracyStats {
  n: number;
  mae?: number;
  bias?: number; // actual − projected (positive = projections too low)
  rmse?: number;
  corr?: number | null;
  mae_consensus?: number; // the consensus on the same players
}

export interface BacktestMetrics {
  n_pool: number;
  n_graded: number;
  projection: Record<string, Record<string, AccuracyStats>>; // source -> ALL|QB|... -> stats
  floor: Record<string, { n: number; below: number; share: number }>;
  floor_target: number;
  dnp: { name: string; pos: Pos; team: string; salary: number; proj: number; status: Status; week?: number }[];
}

export interface BacktestWeek {
  season: number;
  week: number;
  slate_label: string | null;
  snapshot_at: string | null;
  backfilled?: boolean; // rebuilt after the fact: no injury statuses, projections not verified as pre-lock
  players: BacktestRow[];
  metrics: BacktestMetrics;
}

export interface Backtest {
  generated_at: string;
  weeks: BacktestWeek[];
  overall: BacktestMetrics | null;
}
