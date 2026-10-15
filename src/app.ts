import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { alertRoutes } from "./api/alerts.ts";
import { fleetRoutes } from "./api/fleet.ts";
import { healthRoutes } from "./api/health.ts";
import { robotRoutes } from "./api/robots.ts";
import { telemetryRoutes } from "./api/telemetry.ts";
import { AlertService } from "./application/alert-service.ts";
import { systemClock, type Clock } from "./application/clock.ts";
import { FleetQueries } from "./application/fleet-queries.ts";
import { FleetStore } from "./application/fleet-store.ts";
import { IngestionService } from "./application/ingestion-service.ts";
import { Watchdog } from "./application/watchdog.ts";
import { DEFAULT_RULES, type Rules } from "./domain/rules.ts";
import { AlertRepository } from "./storage/alert-repository.ts";
import { RobotRepository } from "./storage/robot-repository.ts";
import { TelemetryRepository } from "./storage/telemetry-repository.ts";

export type AppOptions = {
  db: DatabaseSync;
  logLevel?: string;
  clock?: Clock;
  rules?: Rules;
  watchdogIntervalMs?: number;
};

// Composition root: wires storage, application services and routes.
// Builds the app without starting it, so tests can drive it with app.inject()
// using an in-memory database and a fake clock.
export function buildApp({
  db,
  logLevel = "info",
  clock = systemClock,
  rules = DEFAULT_RULES,
  watchdogIntervalMs = 1_000,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger: { level: logLevel } });
  const logger = app.log;

  const telemetry = new TelemetryRepository(db);
  const robots = new RobotRepository(db);
  const alertRepository = new AlertRepository(db);
  const store = FleetStore.restore(robots.loadAll(), clock(), rules);
  const alerts = new AlertService({ alerts: alertRepository, rules });
  const ingestion = new IngestionService({ db, store, telemetry, robots, alerts, clock, rules, logger });
  const watchdog = new Watchdog({ db, store, alerts, clock, rules, logger });
  const queries = new FleetQueries({ store, telemetry, alerts: alertRepository });

  app.addHook("onReady", async () => watchdog.start(watchdogIntervalMs));
  app.addHook("onClose", async () => watchdog.stop());

  app.register(healthRoutes, { db });
  app.register(telemetryRoutes, { ingestion });
  app.register(fleetRoutes, { queries, clock });
  app.register(robotRoutes, { queries });
  app.register(alertRoutes, { queries });

  return app;
}
