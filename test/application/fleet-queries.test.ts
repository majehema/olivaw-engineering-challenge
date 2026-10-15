import { beforeEach, describe, expect, it } from "vitest";
import { FleetQueries } from "../../src/application/fleet-queries.ts";
import { FleetStore } from "../../src/application/fleet-store.ts";
import type { RobotState } from "../../src/domain/fleet-state.ts";
import { AlertRepository } from "../../src/storage/alert-repository.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { makeAlert, makeRobotState, makeTelemetry, T0 } from "../fixtures.ts";

describe("FleetQueries", () => {
  let store: FleetStore;
  let telemetry: TelemetryRepository;
  let alerts: AlertRepository;
  let queries: FleetQueries;

  const robot = (robotId: string, siteId: string, connectivity: RobotState["connectivity"]) =>
    makeRobotState({ robotId, siteId, connectivity, lastTelemetry: makeTelemetry({ robotId, siteId }) });

  beforeEach(() => {
    const db = openDatabase(IN_MEMORY);
    store = new FleetStore();
    telemetry = new TelemetryRepository(db);
    alerts = new AlertRepository(db);
    queries = new FleetQueries({ store, telemetry, alerts });

    [
      robot("c", "site-b", "online"),
      robot("a", "site-a", "online"),
      robot("b", "site-a", "offline"),
      robot("d", "site-b", "stale"),
    ].forEach((state) => store.set(state));
  });

  describe("summary", () => {
    it("counts robots by connectivity, overall and per site", () => {
      const summary = queries.summary();

      expect(summary.robots).toEqual({ total: 4, online: 2, stale: 1, offline: 1 });
      expect(summary.sites).toEqual([
        { siteId: "site-a", total: 2, online: 1, stale: 0, offline: 1 },
        { siteId: "site-b", total: 2, online: 1, stale: 1, offline: 0 },
      ]);
    });

    it("counts active alerts by severity", () => {
      alerts.insert(makeAlert({ id: "1", robotId: "a", type: "LOW_BATTERY", severity: "warning" }));
      alerts.insert(makeAlert({ id: "2", robotId: "b", type: "OFFLINE", severity: "critical" }));
      alerts.insert(makeAlert({ id: "3", robotId: "b", type: "ROBOT_ERROR", severity: "critical" }));
      alerts.resolve("3", T0 + 1_000);

      expect(queries.summary().alerts).toEqual({ active: 2, critical: 1, warning: 1 });
    });

    it("returns zeros for an empty fleet", () => {
      const empty = new FleetQueries({ store: new FleetStore(), telemetry, alerts });

      expect(empty.summary()).toEqual({
        robots: { total: 0, online: 0, stale: 0, offline: 0 },
        sites: [],
        alerts: { active: 0, critical: 0, warning: 0 },
      });
    });
  });

  describe("robots", () => {
    const ids = (robots: RobotState[]) => robots.map((state) => state.robotId);

    it("returns every robot sorted by id", () => {
      expect(ids(queries.robots())).toEqual(["a", "b", "c", "d"]);
    });

    it("filters by site and connectivity", () => {
      expect(ids(queries.robots({ siteId: "site-a" }))).toEqual(["a", "b"]);
      expect(ids(queries.robots({ connectivity: "online" }))).toEqual(["a", "c"]);
      expect(ids(queries.robots({ siteId: "site-b", connectivity: "online" }))).toEqual(["c"]);
    });
  });

  it("groups open alerts by robot", () => {
    alerts.insert(makeAlert({ id: "1", robotId: "b", type: "OFFLINE" }));
    alerts.insert(makeAlert({ id: "2", robotId: "b", type: "LOW_BATTERY" }));
    alerts.insert(makeAlert({ id: "3", robotId: "a", type: "LOW_BATTERY" }));

    const byRobot = queries.openAlertsByRobot();

    expect(byRobot.get("a")?.map((alert) => alert.id)).toEqual(["3"]);
    expect(byRobot.get("b")?.map((alert) => alert.id).sort()).toEqual(["1", "2"]);
    expect(byRobot.get("c")).toBeUndefined();
  });

  it("returns no history for a robot that never reported", () => {
    expect(queries.history("unknown", { limit: 10 })).toBeUndefined();
    expect(queries.history("a", { limit: 10 })).toEqual([]);
  });
});
