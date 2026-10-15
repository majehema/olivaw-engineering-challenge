import { describe, expect, it } from "vitest";
import { AlertService } from "../../src/application/alert-service.ts";
import { EventBus, type FleetEvent } from "../../src/application/event-bus.ts";
import { FleetStore } from "../../src/application/fleet-store.ts";
import { IngestionService } from "../../src/application/ingestion-service.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import { AlertRepository } from "../../src/storage/alert-repository.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { RobotRepository } from "../../src/storage/robot-repository.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { makeAlert, makeTelemetry, silentLogger, T0 } from "../fixtures.ts";

function setup() {
  const db = openDatabase(IN_MEMORY);
  const store = new FleetStore();
  const telemetry = new TelemetryRepository(db);
  const robots = new RobotRepository(db);
  const alertRepository = new AlertRepository(db);
  const alertService = new AlertService({ alerts: alertRepository, rules: DEFAULT_RULES });
  const clock = { now: T0 };
  const events = new EventBus(silentLogger);
  const published: FleetEvent[] = [];
  events.subscribe((event) => published.push(event));
  const service = new IngestionService({
    db,
    store,
    telemetry,
    robots,
    alerts: alertService,
    clock: () => clock.now,
    rules: DEFAULT_RULES,
    events,
  });
  return { db, store, telemetry, robots, alertRepository, alertService, clock, service, published };
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

  describe("alerts", () => {
    const alertTypes = (repository: AlertRepository) => repository.listOpen().map((alert) => alert.type);

    it("opens an alert when a message breaks a rule", () => {
      const { service, alertRepository } = setup();

      service.ingest([at(0, { battery: 15 })]);

      expect(alertRepository.listOpen()).toEqual([
        expect.objectContaining({ type: "LOW_BATTERY", severity: "warning", openedAt: T0 }),
      ]);
    });

    it("evaluates alerts once per robot on its final state in the batch", () => {
      const { service, alertRepository } = setup();

      service.ingest([at(0, { battery: 15 }), at(1, { battery: 90 })]);

      expect(alertRepository.list({ limit: 10 })).toEqual([]);
    });

    it("resolves an OFFLINE alert when the robot reports again, even with late data", () => {
      const { service, alertRepository, clock } = setup();
      service.ingest([at(10)]);
      alertRepository.insert(makeAlert({ type: "OFFLINE", severity: "critical" }));
      clock.now = T0 + 60_000;

      service.ingest([at(5)]);

      expect(alertTypes(alertRepository)).toEqual([]);
    });

    it("rolls back alerts together with the telemetry when the batch fails", () => {
      const { service, alertService, alertRepository, telemetry } = setup();
      // Fail right after the alert has been written, as the last step of the transaction.
      const evaluate = alertService.evaluate.bind(alertService);
      alertService.evaluate = (...args) => {
        evaluate(...args);
        throw new Error("disk full");
      };

      expect(() => service.ingest([at(0, { battery: 5 })])).toThrow("disk full");
      expect(alertTypes(alertRepository)).toEqual([]);
      expect(telemetry.history("robot-1", { limit: 10 })).toEqual([]);
    });
  });

  describe("events", () => {
    it("publishes the robot update and its alerts after the commit", () => {
      const { service, published } = setup();

      service.ingest([at(0, { battery: 15 })]);

      expect(published.map((event) => event.type)).toEqual(["robot.updated", "alert.opened"]);
      expect(published[0]).toMatchObject({ robot: { robotId: "robot-1", lastTelemetry: at(0, { battery: 15 }) } });
    });

    it("publishes one update per robot per batch, with its final state", () => {
      const { service, published } = setup();

      service.ingest([at(0), at(2), at(1)]);

      expect(published).toEqual([{ type: "robot.updated", robot: expect.objectContaining({ lastTelemetry: at(2) }) }]);
    });

    it("publishes nothing when the batch is rolled back", () => {
      const { service, published, db } = setup();
      db.close();

      expect(() => service.ingest([at(0)])).toThrow();
      expect(published).toEqual([]);
    });
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
