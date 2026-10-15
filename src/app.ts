import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { healthRoutes } from "./api/health.ts";
import { telemetryRoutes } from "./api/telemetry.ts";
import { systemClock, type Clock } from "./application/clock.ts";
import { FleetStore } from "./application/fleet-store.ts";
import { IngestionService } from "./application/ingestion-service.ts";
import { DEFAULT_RULES, type Rules } from "./domain/rules.ts";
import { RobotRepository } from "./storage/robot-repository.ts";
import { TelemetryRepository } from "./storage/telemetry-repository.ts";

export type AppOptions = {
  db: DatabaseSync;
  logLevel?: string;
  clock?: Clock;
  rules?: Rules;
};

// Composition root: wires storage, application services and routes.
// Builds the app without starting it, so tests can drive it with app.inject()
// using an in-memory database and a fake clock.
export function buildApp({
  db,
  logLevel = "info",
  clock = systemClock,
  rules = DEFAULT_RULES,
}: AppOptions): FastifyInstance {
  const telemetry = new TelemetryRepository(db);
  const robots = new RobotRepository(db);
  const store = FleetStore.restore(robots.loadAll(), clock(), rules);
  const ingestion = new IngestionService({ db, store, telemetry, robots, clock, rules });

  const app = Fastify({ logger: { level: logLevel } });
  app.register(healthRoutes, { db });
  app.register(telemetryRoutes, { ingestion });

  return app;
}
