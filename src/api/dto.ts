import type { Alert } from "../domain/alerts.ts";
import type { RobotState } from "../domain/fleet-state.ts";
import type { Telemetry } from "../domain/telemetry.ts";

// The API speaks ISO 8601; epoch milliseconds stay inside the server.
export const toIso = (epochMs: number): string => new Date(epochMs).toISOString();

export function telemetryDto(telemetry: Telemetry) {
  return {
    timestamp: toIso(telemetry.timestamp),
    battery: telemetry.battery,
    position: telemetry.position,
    status: telemetry.status,
  };
}

export function alertDto(alert: Alert) {
  return {
    id: alert.id,
    robotId: alert.robotId,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    openedAt: toIso(alert.openedAt),
    resolvedAt: alert.resolvedAt === null ? null : toIso(alert.resolvedAt),
  };
}

export function robotDto(robot: RobotState, activeAlerts: readonly Alert[]) {
  return {
    robotId: robot.robotId,
    siteId: robot.siteId,
    connectivity: robot.connectivity,
    lastSeenAt: toIso(robot.lastSeenAt),
    telemetry: telemetryDto(robot.lastTelemetry),
    activeAlerts: activeAlerts.map(alertDto),
  };
}
