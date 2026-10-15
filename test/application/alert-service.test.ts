import { beforeEach, describe, expect, it } from "vitest";
import { AlertService } from "../../src/application/alert-service.ts";
import type { Telemetry } from "../../src/domain/telemetry.ts";
import type { RobotState } from "../../src/domain/fleet-state.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import { AlertRepository } from "../../src/storage/alert-repository.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { makeRobotState, makeTelemetry, T0 } from "../fixtures.ts";

describe("AlertService", () => {
  let repository: AlertRepository;
  let service: AlertService;

  beforeEach(() => {
    repository = new AlertRepository(openDatabase(IN_MEMORY));
    let sequence = 0;
    service = new AlertService({ alerts: repository, rules: DEFAULT_RULES, newId: () => `alert-${++sequence}` });
  });

  const robot = (telemetry: Partial<Telemetry>, state: Partial<RobotState> = {}) =>
    makeRobotState({ lastTelemetry: makeTelemetry(telemetry), ...state });

  it("opens and stores an alert", () => {
    const events = service.evaluate(robot({ battery: 15 }), T0);

    const expected = {
      id: "alert-1",
      robotId: "robot-1",
      type: "LOW_BATTERY",
      severity: "warning",
      message: "Battery at 15%",
      openedAt: T0,
      resolvedAt: null,
    };
    expect(events).toEqual([{ kind: "opened", alert: expected }]);
    expect(repository.listOpen()).toEqual([expected]);
  });

  it("does nothing when evaluated again with the same state", () => {
    service.evaluate(robot({ battery: 15 }), T0);

    expect(service.evaluate(robot({ battery: 15 }), T0 + 1_000)).toEqual([]);
    expect(repository.listOpen()).toHaveLength(1);
  });

  it("escalates the open alert", () => {
    service.evaluate(robot({ battery: 15 }), T0);

    const events = service.evaluate(robot({ battery: 5 }), T0 + 1_000);

    expect(events).toEqual([
      { kind: "escalated", alert: expect.objectContaining({ id: "alert-1", severity: "critical", openedAt: T0 }) },
    ]);
    expect(repository.listOpen()).toEqual([expect.objectContaining({ severity: "critical", message: "Battery at 5%" })]);
  });

  it("resolves the open alert", () => {
    service.evaluate(robot({ battery: 15 }), T0);

    const events = service.evaluate(robot({ battery: 30 }), T0 + 60_000);

    expect(events).toEqual([
      { kind: "resolved", alert: expect.objectContaining({ id: "alert-1", resolvedAt: T0 + 60_000 }) },
    ]);
    expect(repository.listOpen()).toEqual([]);
  });

  it("only looks at the evaluated robot's alerts", () => {
    service.evaluate(robot({ battery: 15 }, { robotId: "robot-2" }), T0);

    expect(service.evaluate(robot({ battery: 15 }), T0)).toEqual([
      { kind: "opened", alert: expect.objectContaining({ robotId: "robot-1" }) },
    ]);
  });

  describe("when offline alerts are not allowed (startup grace period)", () => {
    it("does not open an OFFLINE alert", () => {
      expect(service.evaluate(robot({}, { connectivity: "offline" }), T0, { allowOfflineAlerts: false })).toEqual([]);
    });

    it("still opens other alerts", () => {
      const events = service.evaluate(robot({ battery: 5 }, { connectivity: "offline" }), T0, {
        allowOfflineAlerts: false,
      });

      expect(events.map((event) => event.alert.type)).toEqual(["LOW_BATTERY"]);
    });

    it("still resolves an OFFLINE alert when the robot is back", () => {
      service.evaluate(robot({}, { connectivity: "offline" }), T0);

      const events = service.evaluate(robot({}, { connectivity: "online" }), T0 + 1_000, { allowOfflineAlerts: false });

      expect(events).toEqual([{ kind: "resolved", alert: expect.objectContaining({ type: "OFFLINE" }) }]);
    });
  });
});
