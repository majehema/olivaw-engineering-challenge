import { describe, expect, it } from "vitest";
import { FleetStore } from "../../src/application/fleet-store.ts";
import { IngestionService } from "../../src/application/ingestion-service.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { RobotRepository } from "../../src/storage/robot-repository.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { makeTelemetry, T0 } from "../fixtures.ts";

function setup() {
  const db = openDatabase(IN_MEMORY);
  const store = new FleetStore();
  const telemetry = new TelemetryRepository(db);
  const robots = new RobotRepository(db);
  const clock = { now: T0 };
  const service = new IngestionService({
    db,
    store,
    telemetry,
    robots,
    clock: () => clock.now,
    rules: DEFAULT_RULES,
  });
  return { db, store, telemetry, robots, clock, service };
}

const at = (seconds: number, overrides = {}) => makeTelemetry({ timestamp: T0 + seconds * 1_000, ...overrides });

describe("IngestionService", () => {
  it("stores a robot's first message and makes it the current state", () => {
    const { service, store, telemetry, robots } = setup();

    const summary = service.ingest([at(0)]);

    expect(summary).toEqual({ accepted: 1, late: 0, duplicates: 0, rejected: [] });
    expect(store.get("robot-1")?.lastTelemetry).toEqual(at(0));
    expect(telemetry.history("robot-1", { limit: 10 })).toEqual([at(0)]);
    expect(robots.loadAll()).toEqual([{ lastTelemetry: at(0), lastSeenAt: T0 }]);
  });

  it("keeps late data in history without rolling the snapshot back", () => {
    const { service, store, telemetry, clock } = setup();
    service.ingest([at(10)]);
    clock.now = T0 + 20_000;

    const summary = service.ingest([at(5)]);

    expect(summary).toMatchObject({ accepted: 0, late: 1 });
    expect(store.get("robot-1")).toMatchObject({ lastTelemetry: at(10), lastSeenAt: T0 + 20_000 });
    expect(telemetry.history("robot-1", { limit: 10 })).toEqual([at(10), at(5)]);
  });

  it("counts a retried message as a duplicate", () => {
    const { service } = setup();
    service.ingest([at(0)]);

    expect(service.ingest([at(0)])).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("detects a retried old message as a duplicate even though it is older than the snapshot", () => {
    const { service } = setup();
    service.ingest([at(0), at(1)]);

    expect(service.ingest([at(0)])).toMatchObject({ late: 0, duplicates: 1 });
  });

  it("rejects messages from the future and reports their position in the batch", () => {
    const { service, store } = setup();
    const future = at(DEFAULT_RULES.maxClockSkewMs / 1_000 + 1, { robotId: "robot-2" });

    const summary = service.ingest([at(0), future]);

    expect(summary).toEqual({
      accepted: 1,
      late: 0,
      duplicates: 0,
      rejected: [{ index: 1, reason: "timestamp is too far in the future" }],
    });
    expect(store.get("robot-2")).toBeUndefined();
  });

  it("handles out-of-order messages from the same robot within one batch", () => {
    const { service, store } = setup();

    const summary = service.ingest([at(2), at(0), at(3), at(1)]);

    expect(summary).toMatchObject({ accepted: 2, late: 2 });
    expect(store.get("robot-1")?.lastTelemetry).toEqual(at(3));
  });

  it("tracks several robots independently", () => {
    const { service, store } = setup();

    service.ingest([at(0, { robotId: "a" }), at(0, { robotId: "b" }), at(1, { robotId: "a" })]);

    expect(store.all().map((robot) => [robot.robotId, robot.lastTelemetry.timestamp])).toEqual([
      ["a", T0 + 1_000],
      ["b", T0],
    ]);
  });

  it("leaves memory untouched when the database write fails", () => {
    const { service, store, db } = setup();
    service.ingest([at(0)]);
    db.close();

    expect(() => service.ingest([at(1)])).toThrow();
    expect(store.get("robot-1")?.lastTelemetry).toEqual(at(0));
  });
});

describe("FleetStore.restore", () => {
  it("rebuilds the fleet from storage with connectivity derived from the current time", () => {
    const store = FleetStore.restore(
      [
        { lastTelemetry: at(0, { robotId: "a" }), lastSeenAt: T0 },
        { lastTelemetry: at(0, { robotId: "b" }), lastSeenAt: T0 + 50_000 },
      ],
      T0 + 60_000,
      DEFAULT_RULES,
    );

    expect(store.get("a")?.connectivity).toBe("offline");
    expect(store.get("b")?.connectivity).toBe("stale");
  });
});
