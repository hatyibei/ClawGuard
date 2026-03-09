import type Database from "better-sqlite3";

export interface RequestLogEntry {
  provider: string;
  model: string;
  status: string;
  layer: string | null;
  detail: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  saved_cost_usd: number;
  latency_ms: number;
  session_id: string | null;
  request_hash: string | null;
}

export function insertLog(db: Database.Database, entry: RequestLogEntry): number {
  const stmt = db.prepare(`
    INSERT INTO request_logs (provider, model, status, layer, detail, input_tokens, output_tokens, cost_usd, saved_cost_usd, latency_ms, session_id, request_hash)
    VALUES (@provider, @model, @status, @layer, @detail, @input_tokens, @output_tokens, @cost_usd, @saved_cost_usd, @latency_ms, @session_id, @request_hash)
  `);
  const result = stmt.run(entry);
  return result.lastInsertRowid as number;
}

export function getRecentLogs(
  db: Database.Database,
  limit: number = 100,
  statusFilter?: string
): Array<RequestLogEntry & { id: number; timestamp: string }> {
  let query = "SELECT * FROM request_logs";
  const params: string[] = [];

  if (statusFilter) {
    query += " WHERE status = ?";
    params.push(statusFilter);
  }

  query += " ORDER BY id DESC LIMIT ?";
  params.push(String(limit));

  const stmt = db.prepare(query);
  return stmt.all(...params) as Array<RequestLogEntry & { id: number; timestamp: string }>;
}

export interface DailyStats {
  total_requests: number;
  allowed: number;
  blocked_compliance: number;
  blocked_security: number;
  blocked_budget: number;
  routed: number;
  total_cost: number;
  total_saved: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export function getDailyStats(db: Database.Database): DailyStats {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'allowed' THEN 1 ELSE 0 END) as allowed,
      SUM(CASE WHEN status = 'blocked_compliance' THEN 1 ELSE 0 END) as blocked_compliance,
      SUM(CASE WHEN status = 'blocked_security' THEN 1 ELSE 0 END) as blocked_security,
      SUM(CASE WHEN status = 'blocked_budget' THEN 1 ELSE 0 END) as blocked_budget,
      SUM(CASE WHEN status = 'routed' THEN 1 ELSE 0 END) as routed,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(saved_cost_usd), 0) as total_saved,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens
    FROM request_logs
    WHERE date(timestamp) = date('now')
  `);
  return stmt.get() as DailyStats;
}
