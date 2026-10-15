import type { Logger } from "../src/application/logger.ts";
import type { Alert } from "../src/domain/alerts.ts";
import type { RobotState } from "../src/domain/fleet-state.ts";
import type { Telemetry } from "../src/domain/telemetry.ts";

/** Fixed reference time for deterministic tests. */
export const T0 = Date.parse("2026-01-01T12:00:00Z");

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function makeTelemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    robotId: "robot-1",
    siteId: "site-a",
    timestamp: T0,
    battery: 80,
    position: { x: 0, y: 0 },
    status: "moving",
    ...overrides,
  };
}

export function makeRobotState(overrides: Partial<RobotState> = {}): RobotState {
  return {
    robotId: "robot-1",
    siteId: "site-a",
    lastTelemetry: makeTelemetry(),
    lastSeenAt: T0,
    connectivity: "online",
    ...overrides,
  };
}

export function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    robotId: "robot-1",
    type: "LOW_BATTERY",
    severity: "warning",
    message: "",
    openedAt: T0,
    resolvedAt: null,
    ...overrides,
  };
}
