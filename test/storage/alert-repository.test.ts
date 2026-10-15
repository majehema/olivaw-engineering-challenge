import { beforeEach, describe, expect, it } from "vitest";
import { AlertRepository } from "../../src/storage/alert-repository.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { makeAlert, T0 } from "../fixtures.ts";

describe("AlertRepository", () => {
  let alerts: AlertRepository;

  beforeEach(() => {
    alerts = new AlertRepository(openDatabase(IN_MEMORY));
  });

  it("stores an alert and lists it as open", () => {
    const alert = makeAlert({ message: "Battery at 15%" });

    alerts.insert(alert);

    expect(alerts.listOpen()).toEqual([alert]);
  });

  it("escalates an open alert", () => {
    alerts.insert(makeAlert({ severity: "warning" }));

    alerts.escalate("alert-1", "critical", "Battery at 8%");

    expect(alerts.listOpen()).toEqual([makeAlert({ severity: "critical", message: "Battery at 8%" })]);
  });

  it("resolves an alert so it is no longer open", () => {
    alerts.insert(makeAlert());

    alerts.resolve("alert-1", T0 + 60_000);

    expect(alerts.listOpen()).toEqual([]);
    expect(alerts.list({ limit: 10 })).toEqual([makeAlert({ resolvedAt: T0 + 60_000 })]);
  });

  it("refuses a second open alert of the same type for the same robot", () => {
    alerts.insert(makeAlert({ id: "alert-1" }));

    expect(() => alerts.insert(makeAlert({ id: "alert-2" }))).toThrow(/UNIQUE/);
  });

  it("allows a new alert of the same type once the previous one is resolved", () => {
    alerts.insert(makeAlert({ id: "alert-1" }));
    alerts.resolve("alert-1", T0 + 1_000);

    expect(() => alerts.insert(makeAlert({ id: "alert-2", openedAt: T0 + 2_000 }))).not.toThrow();
  });

  describe("list", () => {
    beforeEach(() => {
      alerts.insert(makeAlert({ id: "a", robotId: "robot-1", type: "LOW_BATTERY", openedAt: T0 }));
      alerts.insert(makeAlert({ id: "b", robotId: "robot-1", type: "OFFLINE", openedAt: T0 + 1_000 }));
      alerts.insert(makeAlert({ id: "c", robotId: "robot-2", type: "OFFLINE", openedAt: T0 + 2_000 }));
      alerts.resolve("a", T0 + 3_000);
    });

    const ids = (query: Parameters<AlertRepository["list"]>[0]) => alerts.list(query).map((alert) => alert.id);

    it("returns all alerts, most recently opened first", () => {
      expect(ids({ limit: 10 })).toEqual(["c", "b", "a"]);
    });

    it("filters to active alerts", () => {
      expect(ids({ activeOnly: true, limit: 10 })).toEqual(["c", "b"]);
    });

    it("filters by robot", () => {
      expect(ids({ robotId: "robot-1", limit: 10 })).toEqual(["b", "a"]);
    });

    it("applies the limit", () => {
      expect(ids({ limit: 1 })).toEqual(["c"]);
    });
  });
});
