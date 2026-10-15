import type { Alert } from "../domain/alerts.ts";
import type { RobotState } from "../domain/fleet-state.ts";
import type { AlertEvent } from "./alert-service.ts";
import type { Logger } from "./logger.ts";

export type FleetEvent =
  | { type: "robot.updated"; robot: RobotState }
  | { type: `alert.${AlertEvent["kind"]}`; alert: Alert };

export type FleetEventListener = (event: FleetEvent) => void;

export function toFleetEvent({ kind, alert }: AlertEvent): FleetEvent {
  return { type: `alert.${kind}`, alert };
}

// In-process publish/subscribe. Producers (ingestion, watchdog) publish after
// their transaction commits; consumers (SSE clients, logging) subscribe.
export class EventBus {
  private readonly listeners = new Set<FleetEventListener>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** Returns a function that unsubscribes. */
  subscribe(listener: FleetEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: FleetEvent): void {
    for (const listener of this.listeners) {
      // A failing subscriber must not break ingestion or the other subscribers.
      try {
        listener(event);
      } catch (error) {
        this.logger.error(error, "event listener failed");
      }
    }
  }
}

/** Logs alert changes; robot updates are too frequent to log one by one. */
export function logFleetEvent(logger: Logger, event: FleetEvent): void {
  if (event.type === "robot.updated") return;

  const { alert } = event;
  const fields = { alertId: alert.id, robotId: alert.robotId, type: alert.type, severity: alert.severity };
  if (event.type === "alert.resolved") {
    logger.info(fields, "alert resolved");
  } else {
    logger.warn(fields, `${event.type}: ${alert.message}`);
  }
}
