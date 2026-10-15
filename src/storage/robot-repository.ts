import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { RobotState } from "../domain/fleet-state.ts";
import type { Telemetry } from "../domain/telemetry.ts";
import { toTelemetry, type TelemetryRow } from "./rows.ts";

export type StoredRobot = {
  lastTelemetry: Telemetry;
  lastSeenAt: number;
};

export class RobotRepository {
  private readonly saveStatement: StatementSync;
  private readonly loadAllStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.saveStatement = db.prepare(`
      INSERT INTO robots (robot_id, site_id, last_ts, last_seen_at)
      VALUES (:robotId, :siteId, :lastTs, :lastSeenAt)
      ON CONFLICT (robot_id) DO UPDATE SET
        site_id = excluded.site_id,
        last_ts = excluded.last_ts,
        last_seen_at = excluded.last_seen_at
    `);
    this.loadAllStatement = db.prepare(`
      SELECT t.robot_id, t.site_id, t.ts, t.battery, t.pos_x, t.pos_y, t.status, r.last_seen_at
      FROM robots r
      JOIN telemetry t ON t.robot_id = r.robot_id AND t.ts = r.last_ts
    `);
  }

  /** Persists the robot's snapshot pointer. Its telemetry must already be stored. */
  save(state: RobotState): void {
    this.saveStatement.run({
      robotId: state.robotId,
      siteId: state.siteId,
      lastTs: state.lastTelemetry.timestamp,
      lastSeenAt: state.lastSeenAt,
    });
  }

  loadAll(): StoredRobot[] {
    const rows = this.loadAllStatement.all() as (TelemetryRow & { last_seen_at: number })[];
    return rows.map((row) => ({ lastTelemetry: toTelemetry(row), lastSeenAt: row.last_seen_at }));
  }
}
