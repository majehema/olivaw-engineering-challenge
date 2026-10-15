import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { MAX_BATCH_SIZE } from "../../src/api/telemetry.ts";
import type { TelemetryInput } from "../../src/domain/telemetry.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { T0 } from "../fixtures.ts";

const message = (overrides: Partial<TelemetryInput> = {}): TelemetryInput => ({
  robotId: "robot-1",
  siteId: "site-a",
  timestamp: new Date(T0).toISOString(),
  battery: 80,
  position: { x: 0, y: 0 },
  status: "moving",
  ...overrides,
});

describe("POST /telemetry", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ db: openDatabase(IN_MEMORY), logLevel: "silent", clock: () => T0 });
  });
  afterEach(() => app.close());

  const post = (payload: unknown) => app.inject({ method: "POST", url: "/telemetry", payload: payload as object });

  it("accepts a single message", async () => {
    const response = await post(message());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 1, late: 0, duplicates: 0, rejected: [] });
  });

  it("accepts a batch and reports what happened to each kind of message", async () => {
    const response = await post([
      message({ timestamp: new Date(T0 - 1_000).toISOString() }),
      message({ timestamp: new Date(T0 - 2_000).toISOString() }),
      message({ timestamp: new Date(T0 - 2_000).toISOString() }),
      message({ timestamp: new Date(T0 + 3_600_000).toISOString() }),
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: 1,
      late: 1,
      duplicates: 1,
      rejected: [{ index: 3, reason: "timestamp is too far in the future" }],
    });
  });

  it("rejects the whole request when a message is invalid, pointing at the field", async () => {
    const response = await post([message(), message({ battery: 150 })]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid telemetry",
      issues: [{ path: "1.battery" }],
    });
  });

  it("rejects an empty batch", async () => {
    expect((await post([])).statusCode).toBe(400);
  });

  it(`rejects batches larger than ${MAX_BATCH_SIZE} messages`, async () => {
    const batch = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => message());

    expect((await post(batch)).statusCode).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/telemetry",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
  });
});
