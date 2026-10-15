import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Telemetry } from "../domain/telemetry.ts";
import { TELEMETRY_COLUMNS, toTelemetry, type TelemetryRow } from "./rows.ts";

export type HistoryQuery = {
  /** Inclusive lower bound on the robot timestamp, epoch ms. */
  from?: number;
  /** Inclusive upper bound on the robot timestamp, epoch ms. */
  to?: number;
  limit: number;
};

export class TelemetryRepository {
  private readonly insertStatement: StatementSync;
  private readonly historyStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.insertStatement = db.prepare(`
      INSERT OR IGNORE INTO telemetry (robot_id, site_id, ts, received_at, battery, pos_x, pos_y, status)
      VALUES (:robotId, :siteId, :ts, :receivedAt, :battery, :x, :y, :status)
    `);
    this.historyStatement = db.prepare(`
      SELECT ${TELEMETRY_COLUMNS} FROM telemetry
      WHERE robot_id = :robotId AND ts BETWEEN :from AND :to
      ORDER BY ts DESC
      LIMIT :limit
    `);
  }

  /** Stores a message. Returns false if it was already stored (same robot and timestamp). */
  insert(telemetry: Telemetry, receivedAt: number): boolean {
    const { changes } = this.insertStatement.run({
      robotId: telemetry.robotId,
      siteId: telemetry.siteId,
      ts: telemetry.timestamp,
      receivedAt,
      battery: telemetry.battery,
      x: telemetry.position.x,
      y: telemetry.position.y,
      status: telemetry.status,
    });
    return Number(changes) > 0;
  }

  /** Telemetry for one robot, newest first. */
  history(robotId: string, query: HistoryQuery): Telemetry[] {
    const rows = this.historyStatement.all({
      robotId,
      from: query.from ?? 0,
      to: query.to ?? Number.MAX_SAFE_INTEGER,
      limit: query.limit,
    }) as TelemetryRow[];
    return rows.map(toTelemetry);
  }
}
