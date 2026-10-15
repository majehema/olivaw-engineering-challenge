import type { Connectivity } from "./connectivity.ts";
import type { RobotState } from "./fleet-state.ts";
import type { Rules } from "./rules.ts";
import type { RobotStatus } from "./telemetry.ts";

export type AlertType = "LOW_BATTERY" | "OFFLINE" | "ROBOT_ERROR";
export type AlertSeverity = "warning" | "critical";

export type Alert = {
  id: string;
  robotId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  openedAt: number;
  resolvedAt: number | null;
};

/** What should happen to a robot's alerts. Applying it (ids, persistence) is the caller's job. */
export type AlertChange =
  | { kind: "open"; type: AlertType; severity: AlertSeverity; message: string }
  | { kind: "escalate"; type: AlertType; severity: AlertSeverity; message: string }
  | { kind: "resolve"; type: AlertType };

// Alerts are stateful: at most one open alert per (robot, type). Evaluating the
// same state twice yields no changes, so this is safe to call on every message
// and on every watchdog tick.
export function evaluateAlerts(
  state: RobotState,
  openAlerts: readonly Alert[],
  rules: Rules,
): AlertChange[] {
  const openOf = (type: AlertType) =>
    openAlerts.find((alert) => alert.type === type && alert.resolvedAt === null);

  const changes = [
    evaluateBattery(state.lastTelemetry.battery, openOf("LOW_BATTERY"), rules),
    evaluateRobotError(state.lastTelemetry.status, openOf("ROBOT_ERROR")),
    evaluateOffline(state.connectivity, openOf("OFFLINE")),
  ];
  return changes.filter((change) => change !== null);
}

function evaluateBattery(
  battery: number,
  open: Alert | undefined,
  rules: Rules,
): AlertChange | null {
  const { warningBelow, criticalBelow, recoverAbove } = rules.battery;
  const severity: AlertSeverity | null =
    battery < criticalBelow ? "critical" : battery < warningBelow ? "warning" : null;
  // Floor, not round: 19.5% must not be displayed as "20%" on an alert raised below 20%.
  const message = `Battery at ${Math.floor(battery)}%`;

  if (open === undefined) {
    return severity === null ? null : { kind: "open", type: "LOW_BATTERY", severity, message };
  }
  // Hysteresis: resolve only above recoverAbove, not as soon as battery is back above warningBelow.
  if (battery > recoverAbove) {
    return { kind: "resolve", type: "LOW_BATTERY" };
  }
  // Severity only goes up while the alert is open: it records the worst state reached.
  if (severity === "critical" && open.severity === "warning") {
    return { kind: "escalate", type: "LOW_BATTERY", severity, message };
  }
  return null;
}

function evaluateRobotError(status: RobotStatus, open: Alert | undefined): AlertChange | null {
  if (status === "error" && open === undefined) {
    return { kind: "open", type: "ROBOT_ERROR", severity: "critical", message: "Robot reported an error" };
  }
  if (status !== "error" && open !== undefined) {
    return { kind: "resolve", type: "ROBOT_ERROR" };
  }
  return null;
}

function evaluateOffline(connectivity: Connectivity, open: Alert | undefined): AlertChange | null {
  if (connectivity === "offline" && open === undefined) {
    return { kind: "open", type: "OFFLINE", severity: "critical", message: "Robot stopped reporting" };
  }
  // "stale" does not resolve it: the robot has to actually report again to be back online.
  if (connectivity === "online" && open !== undefined) {
    return { kind: "resolve", type: "OFFLINE" };
  }
  return null;
}
