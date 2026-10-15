import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { buildApp } from "../../src/app.ts";
import type { TelemetryInput } from "../../src/domain/telemetry.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { T0 } from "../fixtures.ts";

const iso = (epochMs: number) => new Date(epochMs).toISOString();

const message = (overrides: Partial<TelemetryInput> = {}): TelemetryInput => ({
  robotId: "robot-1",
  siteId: "site-a",
  timestamp: iso(T0),
  battery: 80,
  position: { x: 1, y: 2 },
  status: "moving",
  ...overrides,
});

describe("read endpoints", () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  const clock = { now: T0 };

  const start = () => buildApp({ db, logLevel: "silent", clock: () => clock.now });
  const get = (url: string) => app.inject({ method: "GET", url });
  const ingest = (payload: TelemetryInput | TelemetryInput[]) =>
    app.inject({ method: "POST", url: "/telemetry", payload });

  beforeEach(async () => {
    db = openDatabase(IN_MEMORY);
    clock.now = T0;
    app = start();
    await ingest([
      message({ robotId: "robot-1", battery: 15 }),
      message({ robotId: "robot-2", siteId: "site-b" }),
    ]);
  });
  afterEach(() => app.close());

  describe("GET /fleet/summary", () => {
    it("returns the fleet's headline numbers", async () => {
      const response = await get("/fleet/summary");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        generatedAt: iso(T0),
        robots: { total: 2, online: 2, stale: 0, offline: 0 },
        sites: [
          { siteId: "site-a", total: 1, online: 1, stale: 0, offline: 0 },
          { siteId: "site-b", total: 1, online: 1, stale: 0, offline: 0 },
        ],
        alerts: { active: 1, critical: 0, warning: 1 },
      });
    });

    it("reflects connectivity derived after a restart", async () => {
      await app.close();
      clock.now = T0 + 60_000;
      app = start();

      const response = await get("/fleet/summary");

      expect(response.json().robots).toEqual({ total: 2, online: 0, stale: 0, offline: 2 });
    });
  });

  describe("GET /robots", () => {
    it("lists every robot with its latest telemetry and active alerts, using ISO timestamps", async () => {
      const response = await get("/robots");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          robotId: "robot-1",
          siteId: "site-a",
          connectivity: "online",
          lastSeenAt: iso(T0),
          telemetry: { timestamp: iso(T0), battery: 15, position: { x: 1, y: 2 }, status: "moving" },
          activeAlerts: [
            {
              id: expect.any(String),
              robotId: "robot-1",
              type: "LOW_BATTERY",
              severity: "warning",
              message: "Battery at 15%",
              openedAt: iso(T0),
              resolvedAt: null,
            },
          ],
        },
        expect.objectContaining({ robotId: "robot-2", activeAlerts: [] }),
      ]);
    });

    it("filters by site and connectivity", async () => {
      const bySite = await get("/robots?siteId=site-b");
      const offline = await get("/robots?connectivity=offline");

      expect(bySite.json().map((robot: { robotId: string }) => robot.robotId)).toEqual(["robot-2"]);
      expect(offline.json()).toEqual([]);
    });

    it("rejects an unknown connectivity value", async () => {
      const response = await get("/robots?connectivity=sleeping");

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Invalid query", issues: [{ path: "connectivity" }] });
    });
  });

  describe("GET /robots/:robotId", () => {
    it("returns one robot with its active alerts", async () => {
      const response = await get("/robots/robot-1");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        robotId: "robot-1",
        activeAlerts: [{ type: "LOW_BATTERY" }],
      });
    });

    it("returns 404 for a robot that never reported", async () => {
      const response = await get("/robots/unknown");

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Robot not found" });
    });
  });

  describe("GET /robots/:robotId/history", () => {
    beforeEach(async () => {
      clock.now = T0 + 10_000;
      await ingest([1, 2, 3, 4].map((second) => message({ timestamp: iso(T0 + second * 1_000) })));
    });

    const timestamps = async (url: string) =>
      (await get(url)).json().map((entry: { timestamp: string }) => (Date.parse(entry.timestamp) - T0) / 1_000);

    it("returns the latest telemetry first", async () => {
      expect(await timestamps("/robots/robot-1/history")).toEqual([4, 3, 2, 1, 0]);
    });

    it("filters by time range and limit", async () => {
      expect(await timestamps(`/robots/robot-1/history?from=${iso(T0 + 1_000)}&to=${iso(T0 + 3_000)}`)).toEqual([
        3, 2, 1,
      ]);
      expect(await timestamps("/robots/robot-1/history?limit=2")).toEqual([4, 3]);
    });

    it.each([
      ["a limit above the maximum", "limit=5000"],
      ["a limit that is not a number", "limit=ten"],
      ["a timestamp that is not ISO 8601", "from=yesterday"],
      ["from after to", `from=${iso(T0 + 3_000)}&to=${iso(T0)}`],
    ])("rejects %s", async (_name, query) => {
      expect((await get(`/robots/robot-1/history?${query}`)).statusCode).toBe(400);
    });

    it("returns 404 for a robot that never reported", async () => {
      expect((await get("/robots/unknown/history")).statusCode).toBe(404);
    });
  });

  describe("GET /alerts", () => {
    beforeEach(async () => {
      clock.now = T0 + 10_000;
      // robot-1 recovers (resolves LOW_BATTERY), robot-2 reports an error.
      await ingest([
        message({ robotId: "robot-1", battery: 90, timestamp: iso(T0 + 5_000) }),
        message({ robotId: "robot-2", siteId: "site-b", status: "error", timestamp: iso(T0 + 5_000) }),
      ]);
    });

    const types = async (url: string) => (await get(url)).json().map((alert: { type: string }) => alert.type);

    it("lists all alerts, most recently opened first, with ISO timestamps", async () => {
      const response = await get("/alerts");

      expect(response.json()).toEqual([
        expect.objectContaining({ type: "ROBOT_ERROR", openedAt: iso(T0 + 10_000), resolvedAt: null }),
        expect.objectContaining({ type: "LOW_BATTERY", openedAt: iso(T0), resolvedAt: iso(T0 + 10_000) }),
      ]);
    });

    it("filters active alerts and by robot", async () => {
      expect(await types("/alerts?active=true")).toEqual(["ROBOT_ERROR"]);
      expect(await types("/alerts?active=false")).toEqual(["ROBOT_ERROR", "LOW_BATTERY"]);
      expect(await types("/alerts?robotId=robot-1")).toEqual(["LOW_BATTERY"]);
    });

    it("rejects a value for active that is not a boolean", async () => {
      expect((await get("/alerts?active=maybe")).statusCode).toBe(400);
    });
  });
});
