import type { RobotStatus, Telemetry } from "../domain/telemetry.ts";

// node:sqlite returns untyped rows. These types describe what our own schema
// returns, so casting query results to them is safe as long as the SQL selects these columns.
export type TelemetryRow = {
  robot_id: string;
  site_id: string;
  ts: number;
  battery: number;
  pos_x: number;
  pos_y: number;
  status: RobotStatus;
};

export const TELEMETRY_COLUMNS = "robot_id, site_id, ts, battery, pos_x, pos_y, status";

export function toTelemetry(row: TelemetryRow): Telemetry {
  return {
    robotId: row.robot_id,
    siteId: row.site_id,
    timestamp: row.ts,
    battery: row.battery,
    position: { x: row.pos_x, y: row.pos_y },
    status: row.status,
  };
}
