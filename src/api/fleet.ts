import type { FastifyPluginAsync } from "fastify";
import type { Clock } from "../application/clock.ts";
import type { FleetQueries } from "../application/fleet-queries.ts";
import { toIso } from "./dto.ts";

export type FleetRoutesOptions = {
  queries: FleetQueries;
  clock: Clock;
};

export const fleetRoutes: FastifyPluginAsync<FleetRoutesOptions> = async (app, { queries, clock }) => {
  // The dashboard's headline numbers. generatedAt lets a client show how fresh they are.
  app.get("/fleet/summary", async () => ({
    generatedAt: toIso(clock()),
    ...queries.summary(),
  }));
};
