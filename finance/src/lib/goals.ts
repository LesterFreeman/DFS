import { accountsSeries } from './analytics';
import { addDays, daysBetween } from './dates';
import type { AppData, Goal } from './types';

export interface GoalStatus {
  /** Saved so far, or paid off so far. */
  done: number;
  /** Total to save, or total to pay off. */
  total: number;
  remaining: number;
  /** 0 to 1. */
  progress: number;
  complete: boolean;
  /** Average monthly progress over the last ~90 days. Null without enough history. */
  pace: number | null;
  /** Monthly amount needed to finish by the target date. Null without a date. */
  needed: number | null;
  monthsLeft: number | null;
  /** Null when there is nothing to judge by (no date, or no pace yet). */
  onTrack: boolean | null;
}

export function goalStatus(data: AppData, goal: Goal, today: string): GoalStatus {
  const series = accountsSeries(data, goal.accountIds, today);
  const current = series[series.length - 1].value;
  const payoff = goal.kind === 'payoff';
  const total = payoff ? Math.max(goal.startAmount, current) : goal.target;
  const done = payoff ? total - current : current;
  const remaining = Math.max(0, total - done);
  const complete = total > 0 && remaining <= 0.5;

  // Pace: change against the snapshot closest to 90 days back (at least 20 days of history).
  let pace: number | null = null;
  const from = addDays(today, -90);
  const earlier = series.filter((p) => p.date < today);
  const base = earlier.find((p) => p.date >= from) ?? earlier[earlier.length - 1];
  if (base) {
    const days = daysBetween(base.date, today);
    if (days >= 20) {
      const delta = payoff ? base.value - current : current - base.value;
      pace = (delta / days) * 30.44;
    }
  }

  let needed: number | null = null;
  let monthsLeft: number | null = null;
  if (goal.targetDate) {
    monthsLeft = daysBetween(today, goal.targetDate) / 30.44;
    needed = complete ? 0 : monthsLeft > 0.5 ? remaining / monthsLeft : remaining;
  }
  const onTrack = complete ? true : needed === null || pace === null ? null : pace >= needed * 0.9;
  return { done, total, remaining, progress: total > 0 ? Math.min(1, Math.max(0, done / total)) : 0, complete, pace, needed, monthsLeft, onTrack };
}
