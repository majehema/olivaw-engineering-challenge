import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FleetQueries } from "../application/fleet-queries.ts";
import { CONNECTIVITY_STATES } from "../domain/connectivity.ts";
import { robotDto, telemetryDto } from "./dto.ts";
import { badRequest, isoTimestampSchema, limitSchema, notFound } from "./validation.ts";

const listQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
  connectivity: z.enum(CONNECTIVITY_STATES).optional(),
});

const historyQuerySchema = z
  .object({
    from: isoTimestampSchema.optional(),
    to: isoTimestampSchema.optional(),
    limit: limitSchema(100, 1_000),
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    message: "from must not be after to",
    path: ["from"],
  });

type RobotParams = { Params: { robotId: string } };

export type RobotRoutesOptions = {
  queries: FleetQueries;
};

export const robotRoutes: FastifyPluginAsync<RobotRoutesOptions> = async (app, { queries }) => {
  app.get("/robots", async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, "Invalid query", query.error);

    const alertsByRobot = queries.openAlertsByRobot();
    return queries.robots(query.data).map((robot) => robotDto(robot, alertsByRobot.get(robot.robotId) ?? []));
  });

  app.get<RobotParams>("/robots/:robotId", async (request, reply) => {
    const { robotId } = request.params;

    const robot = queries.robot(robotId);
    if (robot === undefined) return notFound(reply, "Robot not found");

    return robotDto(robot, queries.openAlertsFor(robotId));
  });

  // Newest first. Without from/to it returns the latest `limit` messages.
  app.get<RobotParams>("/robots/:robotId/history", async (request, reply) => {
    const { robotId } = request.params;
    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, "Invalid query", query.error);

    const history = queries.history(robotId, query.data);
    if (history === undefined) return notFound(reply, "Robot not found");

    return history.map(telemetryDto);
  });
};
