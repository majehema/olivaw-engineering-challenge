import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { EventBus, FleetEvent } from "../application/event-bus.ts";
import type { FleetQueries } from "../application/fleet-queries.ts";
import { alertDto, robotDto, robotStateDto } from "./dto.ts";
import { SseConnection } from "./sse.ts";
import { badRequest } from "./validation.ts";

const HEARTBEAT_MS = 15_000;
const MAX_BUFFERED_BYTES = 1_000_000;

const eventsQuerySchema = z.object({
  robotId: z.string().min(1).optional(),
});

export type EventRoutesOptions = {
  events: EventBus;
  queries: FleetQueries;
};

export const eventRoutes: FastifyPluginAsync<EventRoutesOptions> = async (app, { events, queries }) => {
  const connections = new Set<SseConnection>();

  // SSE connections never end on their own, so they would keep app.close() waiting forever.
  app.addHook("preClose", async () => {
    for (const connection of connections) connection.close();
  });

  // Live stream: a `snapshot` of the current state first, then every change.
  // Optional ?robotId= limits the stream to one robot.
  app.get("/events", async (request, reply) => {
    const query = eventsQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, "Invalid query", query.error);
    const { robotId } = query.data;

    // From here on the response is written by hand, not by Fastify.
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // Tells nginx-style proxies not to buffer the stream.
      "x-accel-buffering": "no",
    });

    let unsubscribe = () => {};
    let heartbeat: NodeJS.Timeout | undefined;
    const connection = new SseConnection(reply.raw, MAX_BUFFERED_BYTES, () => {
      unsubscribe();
      clearInterval(heartbeat);
      connections.delete(connection);
    });
    connections.add(connection);

    // Snapshot and subscription happen in the same synchronous block, so no
    // event can slip in between them: the client sees every change after the snapshot.
    const alertsByRobot = queries.openAlertsByRobot();
    const robots = robotId === undefined ? queries.robots() : [queries.robot(robotId)].filter((robot) => robot !== undefined);
    connection.send("snapshot", {
      robots: robots.map((robot) => robotDto(robot, alertsByRobot.get(robot.robotId) ?? [])),
    });
    unsubscribe = events.subscribe((event) => {
      if (robotId === undefined || robotIdOf(event) === robotId) {
        connection.send(event.type, payloadOf(event));
      }
    });
    heartbeat = setInterval(() => connection.comment("heartbeat"), HEARTBEAT_MS);

    request.raw.on("close", () => connection.close());
  });
};

function robotIdOf(event: FleetEvent): string {
  return event.type === "robot.updated" ? event.robot.robotId : event.alert.robotId;
}

function payloadOf(event: FleetEvent) {
  return event.type === "robot.updated" ? robotStateDto(event.robot) : alertDto(event.alert);
}
