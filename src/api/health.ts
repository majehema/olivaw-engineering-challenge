import type { FastifyPluginAsync } from "fastify";
import type { DatabaseSync } from "node:sqlite";

export type HealthOptions = {
  db: DatabaseSync;
};

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, { db }) => {
  app.get("/health", async (request, reply) => {
    try {
      db.prepare("SELECT 1").get();
    } catch (error) {
      request.log.error(error, "database health check failed");
      return reply.code(503).send({ status: "unavailable", database: "unreachable" });
    }

    return {
      status: "ok",
      database: "ok",
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
};
