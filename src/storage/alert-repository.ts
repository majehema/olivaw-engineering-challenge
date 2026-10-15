import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Alert, AlertSeverity, AlertType } from "../domain/alerts.ts";

type AlertRow = {
  id: string;
  robot_id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  opened_at: number;
  resolved_at: number | null;
};

export type AlertQuery = {
  activeOnly?: boolean;
  robotId?: string;
  limit: number;
};

const COLUMNS = "id, robot_id, type, severity, message, opened_at, resolved_at";

export class AlertRepository {
  private readonly insertStatement: StatementSync;
  private readonly escalateStatement: StatementSync;
  private readonly resolveStatement: StatementSync;
  private readonly listOpenStatement: StatementSync;
  private readonly listStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.insertStatement = db.prepare(`
      INSERT INTO alerts (${COLUMNS})
      VALUES (:id, :robotId, :type, :severity, :message, :openedAt, NULL)
    `);
    this.escalateStatement = db.prepare(`
      UPDATE alerts SET severity = :severity, message = :message
      WHERE id = :id AND resolved_at IS NULL
    `);
    this.resolveStatement = db.prepare(`
      UPDATE alerts SET resolved_at = :resolvedAt
      WHERE id = :id AND resolved_at IS NULL
    `);
    this.listOpenStatement = db.prepare(`
      SELECT ${COLUMNS} FROM alerts WHERE resolved_at IS NULL
    `);
    this.listStatement = db.prepare(`
      SELECT ${COLUMNS} FROM alerts
      WHERE (:robotId IS NULL OR robot_id = :robotId)
        AND (:activeOnly = 0 OR resolved_at IS NULL)
      ORDER BY opened_at DESC
      LIMIT :limit
    `);
  }

  insert(alert: Alert): void {
    this.insertStatement.run({
      id: alert.id,
      robotId: alert.robotId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      openedAt: alert.openedAt,
    });
  }

  escalate(id: string, severity: AlertSeverity, message: string): void {
    this.escalateStatement.run({ id, severity, message });
  }

  resolve(id: string, resolvedAt: number): void {
    this.resolveStatement.run({ id, resolvedAt });
  }

  listOpen(): Alert[] {
    return (this.listOpenStatement.all() as AlertRow[]).map(toAlert);
  }

  /** Alerts matching the query, most recently opened first. */
  list(query: AlertQuery): Alert[] {
    const rows = this.listStatement.all({
      robotId: query.robotId ?? null,
      activeOnly: query.activeOnly ? 1 : 0,
      limit: query.limit,
    }) as AlertRow[];
    return rows.map(toAlert);
  }
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    robotId: row.robot_id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
  };
}
