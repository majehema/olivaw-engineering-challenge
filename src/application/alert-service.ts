import { randomUUID } from "node:crypto";
import { evaluateAlerts, type Alert, type AlertChange, type AlertType } from "../domain/alerts.ts";
import type { RobotState } from "../domain/fleet-state.ts";
import type { Rules } from "../domain/rules.ts";
import type { AlertRepository } from "../storage/alert-repository.ts";
import type { Logger } from "./logger.ts";

export type AlertEvent = {
  kind: "opened" | "escalated" | "resolved";
  alert: Alert;
};

export type EvaluateOptions = {
  /** False during the startup grace period, see Watchdog. */
  allowOfflineAlerts?: boolean;
};

export type AlertServiceDependencies = {
  alerts: AlertRepository;
  rules: Rules;
  newId?: () => string;
};

// Applies the domain's alert decisions to the database. Open alerts are read
// from the database on every evaluation (an indexed lookup), so there is no
// in-memory copy that could disagree with it.
export class AlertService {
  private readonly deps: Required<AlertServiceDependencies>;

  constructor({ newId = randomUUID, ...deps }: AlertServiceDependencies) {
    this.deps = { newId, ...deps };
  }

  /** Writes to the database: call it inside the caller's transaction. */
  evaluate(state: RobotState, now: number, { allowOfflineAlerts = true }: EvaluateOptions = {}): AlertEvent[] {
    const open = this.deps.alerts.listOpenForRobot(state.robotId);
    return evaluateAlerts(state, open, this.deps.rules)
      .filter((change) => allowOfflineAlerts || !(change.kind === "open" && change.type === "OFFLINE"))
      .map((change) => this.apply(change, state.robotId, open, now));
  }

  private apply(change: AlertChange, robotId: string, open: readonly Alert[], now: number): AlertEvent {
    const { alerts, newId } = this.deps;

    switch (change.kind) {
      case "open": {
        const alert: Alert = {
          id: newId(),
          robotId,
          type: change.type,
          severity: change.severity,
          message: change.message,
          openedAt: now,
          resolvedAt: null,
        };
        alerts.insert(alert);
        return { kind: "opened", alert };
      }
      case "escalate": {
        const current = findOpen(open, change.type);
        alerts.escalate(current.id, change.severity, change.message);
        return { kind: "escalated", alert: { ...current, severity: change.severity, message: change.message } };
      }
      case "resolve": {
        const current = findOpen(open, change.type);
        alerts.resolve(current.id, now);
        return { kind: "resolved", alert: { ...current, resolvedAt: now } };
      }
    }
  }
}

function findOpen(open: readonly Alert[], type: AlertType): Alert {
  const alert = open.find((candidate) => candidate.type === type);
  // The domain only escalates or resolves alerts it was given as open.
  if (alert === undefined) throw new Error(`No open ${type} alert to update`);
  return alert;
}

export function logAlertEvent(logger: Logger, { kind, alert }: AlertEvent): void {
  const fields = { alertId: alert.id, robotId: alert.robotId, type: alert.type, severity: alert.severity };
  if (kind === "resolved") {
    logger.info(fields, "alert resolved");
  } else {
    logger.warn(fields, `alert ${kind}: ${alert.message}`);
  }
}
