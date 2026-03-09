import type Database from "better-sqlite3";

export interface BudgetState {
  daily_spent_usd: number;
  monthly_spent_usd: number;
  daily_saved_usd: number;
  daily_requests: number;
  last_reset_day: string;
  last_reset_month: string;
}

export function getBudgetState(db: Database.Database): BudgetState {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const state = db.prepare("SELECT * FROM budget_state WHERE id = 1").get() as BudgetState;

  // Auto-reset daily counters
  if (state.last_reset_day !== today) {
    db.prepare(`
      UPDATE budget_state SET
        daily_spent_usd = 0,
        daily_saved_usd = 0,
        daily_requests = 0,
        last_reset_day = ?
      WHERE id = 1
    `).run(today);
    state.daily_spent_usd = 0;
    state.daily_saved_usd = 0;
    state.daily_requests = 0;
    state.last_reset_day = today;
  }

  // Auto-reset monthly counters
  if (state.last_reset_month !== thisMonth) {
    db.prepare(`
      UPDATE budget_state SET
        monthly_spent_usd = 0,
        last_reset_month = ?
      WHERE id = 1
    `).run(thisMonth);
    state.monthly_spent_usd = 0;
    state.last_reset_month = thisMonth;
  }

  return state;
}

export function addSpending(
  db: Database.Database,
  costUsd: number,
  savedUsd: number = 0
): void {
  db.prepare(`
    UPDATE budget_state SET
      daily_spent_usd = daily_spent_usd + ?,
      monthly_spent_usd = monthly_spent_usd + ?,
      daily_saved_usd = daily_saved_usd + ?,
      daily_requests = daily_requests + 1
    WHERE id = 1
  `).run(costUsd, costUsd, savedUsd);
}
