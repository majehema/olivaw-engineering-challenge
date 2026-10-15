import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { healthRoutes } from "./api/health.ts";

export type AppOptions = {
  db: DatabaseSync;
  logLevel?: string;
};

// Builds the app without starting it, so tests can drive it with app.inject().
// Dependencies are passed in: tests use an in-memory database.
export function buildApp({ db, logLevel = "info" }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: { level: logLevel } });

  app.register(healthRoutes, { db });

  return app;
}
