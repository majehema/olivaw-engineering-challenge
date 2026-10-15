import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./api/health.ts";

export type AppOptions = {
  logLevel?: string;
};

// Builds the app without starting it, so tests can drive it with app.inject().
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: options.logLevel ?? "info" } });

  app.register(healthRoutes);

  return app;
}
