import type { DatabaseSync } from "node:sqlite";
import { ingestTelemetry, type RobotState } from "../domain/fleet-state.ts";
import type { Rules } from "../domain/rules.ts";
import type { Telemetry } from "../domain/telemetry.ts";
import type { RobotRepository } from "../storage/robot-repository.ts";
import type { TelemetryRepository } from "../storage/telemetry-repository.ts";
import { transaction } from "../storage/transaction.ts";
import type { AlertService } from "./alert-service.ts";
import type { Clock } from "./clock.ts";
import { toFleetEvent, type EventBus } from "./event-bus.ts";
import type { FleetStore } from "./fleet-store.ts";

export type IngestSummary = {
  /** Newer than the robot's snapshot: stored and applied. */
  accepted: number;
  /** Older than the snapshot: stored in history only. */
  late: number;
  /** Already stored (producer retry): ignored. */
  duplicates: number;
  /** Not stored, with the position of the message in the batch. */
  rejected: { index: number; reason: string }[];
};

export type IngestionDependencies = {
  db: DatabaseSync;
  store: FleetStore;
  telemetry: TelemetryRepository;
  robots: RobotRepository;
  alerts: AlertService;
  clock: Clock;
  rules: Rules;
  events: EventBus;
};

export class IngestionService {
  private readonly deps: IngestionDependencies;

  constructor(deps: IngestionDependencies) {
    this.deps = deps;
  }

  ingest(messages: readonly Telemetry[]): IngestSummary {
    const { db, store, telemetry, robots, alerts, clock, rules, events } = this.deps;
    const now = clock();
    const summary: IngestSummary = { accepted: 0, late: 0, duplicates: 0, rejected: [] };

    // Snapshots changed by this batch. Several messages may belong to the same robot,
    // so each one is classified against the result of the previous one.
    const updated = new Map<string, RobotState>();

    const alertEvents = transaction(db, () => {
      messages.forEach((message, index) => {
        const current = updated.get(message.robotId) ?? store.get(message.robotId);
        const outcome = ingestTelemetry(current, message, now, rules);

        if (outcome.kind === "rejected") {
          summary.rejected.push({ index, reason: outcome.reason });
          return;
        }

        // Storage has the final word on duplicates: a retried message older than
        // the snapshot looks "late" to the domain but is already in the history.
        const stored = telemetry.insert(message, now);
        const kind = stored ? outcome.kind : "duplicate";
        if (kind === "applied") summary.accepted++;
        else if (kind === "late") summary.late++;
        else summary.duplicates++;

        robots.save(outcome.state);
        updated.set(outcome.state.robotId, outcome.state);
      });

      // Once per robot, on its final state: a batch where the battery dips and
      // recovers should not open and immediately resolve an alert.
      return [...updated.values()].flatMap((state) => alerts.evaluate(state, now));
    });

    // Only after the commit, so memory and subscribers never see what the database does not have.
    updated.forEach((state) => {
      store.set(state);
      events.publish({ type: "robot.updated", robot: state });
    });
    alertEvents.forEach((event) => events.publish(toFleetEvent(event)));
    return summary;
  }
}
