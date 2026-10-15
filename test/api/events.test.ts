import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { EventBus } from "../../src/application/event-bus.ts";
import type { TelemetryInput } from "../../src/domain/telemetry.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { silentLogger, T0 } from "../fixtures.ts";

type SseEvent = { event: string; data: any };

const message = (overrides: Partial<TelemetryInput> = {}): TelemetryInput => ({
  robotId: "robot-1",
  siteId: "site-a",
  timestamp: new Date(T0).toISOString(),
  battery: 80,
  position: { x: 0, y: 0 },
  status: "moving",
  ...overrides,
});

/** Opens a real SSE connection and parses events as they arrive. */
async function openStream(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  async function next(): Promise<SseEvent> {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith(":")) continue; // comment
        const field = (name: string) => block.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
        return { event: field("event"), data: JSON.parse(field("data")) };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += value;
    }
  }

  return { response, next, close: () => controller.abort() };
}

describe("GET /events", () => {
  let app: FastifyInstance;
  let events: EventBus;
  let baseUrl: string;

  const ingest = (payload: TelemetryInput | TelemetryInput[]) =>
    app.inject({ method: "POST", url: "/telemetry", payload });

  beforeEach(async () => {
    events = new EventBus(silentLogger);
    app = buildApp({ db: openDatabase(IN_MEMORY), logLevel: "silent", clock: () => T0, events });
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    await ingest(message({ robotId: "robot-1" }));
  });
  afterEach(() => app.close());

  it("starts with a snapshot of the fleet, then streams changes", async () => {
    const stream = await openStream(`${baseUrl}/events`);

    expect(stream.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await stream.next()).toEqual({
      event: "snapshot",
      data: { robots: [expect.objectContaining({ robotId: "robot-1", activeAlerts: [] })] },
    });

    await ingest(message({ robotId: "robot-2", battery: 5, timestamp: new Date(T0).toISOString() }));

    expect(await stream.next()).toEqual({
      event: "robot.updated",
      data: expect.objectContaining({ robotId: "robot-2", telemetry: expect.objectContaining({ battery: 5 }) }),
    });
    expect(await stream.next()).toEqual({
      event: "alert.opened",
      data: expect.objectContaining({ robotId: "robot-2", type: "LOW_BATTERY", severity: "critical" }),
    });
    stream.close();
  });

  it("streams only one robot when robotId is given", async () => {
    const stream = await openStream(`${baseUrl}/events?robotId=robot-2`);
    expect(await stream.next()).toEqual({ event: "snapshot", data: { robots: [] } });

    await ingest([message({ robotId: "robot-1", timestamp: new Date(T0 - 1_000).toISOString() }), message({ robotId: "robot-2" })]);

    expect(await stream.next()).toMatchObject({ event: "robot.updated", data: { robotId: "robot-2" } });
    stream.close();
  });

  it("unsubscribes when the client disconnects", async () => {
    const before = events.subscriberCount;
    const stream = await openStream(`${baseUrl}/events`);
    await stream.next();
    expect(events.subscriberCount).toBe(before + 1);

    stream.close();

    await expect.poll(() => events.subscriberCount).toBe(before);
  });

  it("does not keep the server from shutting down", async () => {
    const stream = await openStream(`${baseUrl}/events`);
    await stream.next();

    await app.close();

    await expect(stream.next()).rejects.toThrow();
  });

  it("rejects an invalid query", async () => {
    const response = await app.inject({ method: "GET", url: "/events?robotId=" });

    expect(response.statusCode).toBe(400);
  });
});
