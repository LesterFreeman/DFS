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
