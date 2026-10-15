import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FleetQueries } from "../application/fleet-queries.ts";
import { alertDto } from "./dto.ts";
import { badRequest, limitSchema } from "./validation.ts";

const alertsQuerySchema = z.object({
  // stringbool: "true"/"false" in a query string. z.coerce.boolean("false") would be true.
  active: z.stringbool().optional(),
  robotId: z.string().min(1).optional(),
  limit: limitSchema(100, 1_000),
});

export type AlertRoutesOptions = {
  queries: FleetQueries;
};

export const alertRoutes: FastifyPluginAsync<AlertRoutesOptions> = async (app, { queries }) => {
  // Most recently opened first.
  app.get("/alerts", async (request, reply) => {
    const query = alertsQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, "Invalid query", query.error);

    const { active, robotId, limit } = query.data;
    return queries.alerts({ activeOnly: active, robotId, limit }).map(alertDto);
  });
};
