import type { DatabaseSync } from "node:sqlite";
import { refreshConnectivity } from "../domain/fleet-state.ts";
import type { Rules } from "../domain/rules.ts";
import { transaction } from "../storage/transaction.ts";
import { logAlertEvent, type AlertService } from "./alert-service.ts";
import type { Clock } from "./clock.ts";
import type { FleetStore } from "./fleet-store.ts";
import type { Logger } from "./logger.ts";

export type WatchdogDependencies = {
  db: DatabaseSync;
  store: FleetStore;
  alerts: AlertService;
  clock: Clock;
  rules: Rules;
  logger: Logger;
};

// Detects robots that went silent. Silence produces no message, so something
// has to look at the clock periodically: this runs on a timer.
export class Watchdog {
  private readonly deps: WatchdogDependencies;
  private readonly startedAt: number;
  private graceOver = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(deps: WatchdogDependencies) {
    this.deps = deps;
    this.startedAt = deps.clock();
  }

  start(intervalMs: number): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        // An exception inside setInterval would crash the process; log it and try again next tick.
        this.deps.logger.error(error, "watchdog tick failed");
      }
    }, intervalMs);
    // Do not keep the process alive just for the watchdog.
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(): void {
    const { db, store, alerts, clock, rules, logger } = this.deps;
    const now = clock();

    // After a restart every robot looks silent: the server cannot tell a robot's
    // silence from its own downtime. Give robots one offline window to report
    // before raising OFFLINE alerts, then re-evaluate everyone once.
    const graceOver = now - this.startedAt >= rules.offlineAfterMs;
    const graceJustEnded = graceOver && !this.graceOver;
    this.graceOver = graceOver;

    const changed = store
      .all()
      .map((before) => ({ before, after: refreshConnectivity(before, now, rules) }))
      .filter(({ before, after }) => before !== after || graceJustEnded);
    if (changed.length === 0) return;

    const events = transaction(db, () =>
      changed.flatMap(({ after }) => alerts.evaluate(after, now, { allowOfflineAlerts: graceOver })),
    );

    for (const { before, after } of changed) {
      store.set(after);
      if (before.connectivity !== after.connectivity) {
        logger.info(
          { robotId: after.robotId, from: before.connectivity, to: after.connectivity },
          "robot connectivity changed",
        );
      }
    }
    events.forEach((event) => logAlertEvent(logger, event));
  }
}
