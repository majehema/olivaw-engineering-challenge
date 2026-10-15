import { describe, expect, it } from "vitest";
import { evaluateAlerts, type Alert } from "../../src/domain/alerts.ts";
import type { RobotState } from "../../src/domain/fleet-state.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import type { Telemetry } from "../../src/domain/telemetry.ts";
import { makeAlert, makeRobotState, makeTelemetry } from "../fixtures.ts";

function evaluate(
  telemetry: Partial<Telemetry>,
  openAlerts: Alert[] = [],
  state: Partial<RobotState> = {},
) {
  const robot = makeRobotState({ lastTelemetry: makeTelemetry(telemetry), ...state });
  return evaluateAlerts(robot, openAlerts, DEFAULT_RULES);
}

describe("evaluateAlerts", () => {
  it("returns no changes for a healthy robot", () => {
    expect(evaluate({ battery: 80 })).toEqual([]);
  });

  describe("low battery", () => {
    const warning = makeAlert({ type: "LOW_BATTERY", severity: "warning" });
    const critical = makeAlert({ type: "LOW_BATTERY", severity: "critical" });

    it.each([
      [20, []],
      [19.5, [{ kind: "open", type: "LOW_BATTERY", severity: "warning", message: "Battery at 19%" }]],
      [9, [{ kind: "open", type: "LOW_BATTERY", severity: "critical", message: "Battery at 9%" }]],
    ])("with no open alert, battery at %d gives %j", (battery, expected) => {
      expect(evaluate({ battery })).toEqual(expected);
    });

    it("escalates an open warning when battery becomes critical", () => {
      expect(evaluate({ battery: 8 }, [warning])).toEqual([
        { kind: "escalate", type: "LOW_BATTERY", severity: "critical", message: "Battery at 8%" },
      ]);
    });

    it("does not open a second alert while one is open", () => {
      expect(evaluate({ battery: 15 }, [warning])).toEqual([]);
    });

    it("does not de-escalate a critical alert while battery recovers", () => {
      expect(evaluate({ battery: 15 }, [critical])).toEqual([]);
    });

    it.each([21, 25])("keeps the alert open with battery at %d (hysteresis)", (battery) => {
      expect(evaluate({ battery }, [warning])).toEqual([]);
    });

    it("resolves the alert above the recovery threshold", () => {
      expect(evaluate({ battery: 26 }, [critical])).toEqual([{ kind: "resolve", type: "LOW_BATTERY" }]);
    });
  });

  describe("robot error", () => {
    const open = makeAlert({ type: "ROBOT_ERROR", severity: "critical" });

    it("opens an alert when the robot reports an error", () => {
      expect(evaluate({ status: "error" })).toEqual([
        { kind: "open", type: "ROBOT_ERROR", severity: "critical", message: "Robot reported an error" },
      ]);
    });

    it("does nothing while the error persists", () => {
      expect(evaluate({ status: "error" }, [open])).toEqual([]);
    });

    it("resolves when the robot leaves the error status", () => {
      expect(evaluate({ status: "idle" }, [open])).toEqual([{ kind: "resolve", type: "ROBOT_ERROR" }]);
    });
  });

  describe("offline", () => {
    const open = makeAlert({ type: "OFFLINE", severity: "critical" });

    it("opens an alert when the robot goes offline", () => {
      expect(evaluate({}, [], { connectivity: "offline" })).toEqual([
        { kind: "open", type: "OFFLINE", severity: "critical", message: "Robot stopped reporting" },
      ]);
    });

    it("does not alert while the robot is only stale", () => {
      expect(evaluate({}, [], { connectivity: "stale" })).toEqual([]);
    });

    it("keeps the alert open while the robot is stale", () => {
      expect(evaluate({}, [open], { connectivity: "stale" })).toEqual([]);
    });

    it("resolves when the robot is back online", () => {
      expect(evaluate({}, [open], { connectivity: "online" })).toEqual([{ kind: "resolve", type: "OFFLINE" }]);
    });
  });

  it("ignores alerts that are already resolved", () => {
    const resolved = makeAlert({ type: "LOW_BATTERY", resolvedAt: 1 });

    expect(evaluate({ battery: 15 }, [resolved])).toEqual([
      { kind: "open", type: "LOW_BATTERY", severity: "warning", message: "Battery at 15%" },
    ]);
  });

  it("reports several changes at once", () => {
    const changes = evaluate({ battery: 5, status: "error" }, [], { connectivity: "offline" });

    expect(changes.map((change) => change.type)).toEqual(["LOW_BATTERY", "ROBOT_ERROR", "OFFLINE"]);
  });
});
