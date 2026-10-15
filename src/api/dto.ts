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

/** A robot's state without its alerts: the payload of `robot.updated` events. */
export function robotStateDto(robot: RobotState) {
  return {
    robotId: robot.robotId,
    siteId: robot.siteId,
    connectivity: robot.connectivity,
    lastSeenAt: toIso(robot.lastSeenAt),
    telemetry: telemetryDto(robot.lastTelemetry),
  };
}

export function robotDto(robot: RobotState, activeAlerts: readonly Alert[]) {
  return {
    ...robotStateDto(robot),
    activeAlerts: activeAlerts.map(alertDto),
  };
}
