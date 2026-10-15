import { describe, expect, it, vi } from "vitest";
import { EventBus, logFleetEvent, toFleetEvent, type FleetEvent } from "../../src/application/event-bus.ts";
import { makeAlert, makeRobotState, silentLogger } from "../fixtures.ts";

const robotUpdated: FleetEvent = { type: "robot.updated", robot: makeRobotState() };

describe("EventBus", () => {
  it("delivers events to every subscriber until it unsubscribes", () => {
    const bus = new EventBus(silentLogger);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = bus.subscribe(first);
    bus.subscribe(second);

    bus.publish(robotUpdated);
    unsubscribeFirst();
    bus.publish(robotUpdated);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(bus.subscriberCount).toBe(1);
  });

  it("keeps delivering to other subscribers when one throws", () => {
    const logger = { ...silentLogger, error: vi.fn() };
    const bus = new EventBus(logger);
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error("broken subscriber");
    });
    bus.subscribe(healthy);

    expect(() => bus.publish(robotUpdated)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(robotUpdated);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe("toFleetEvent", () => {
  it("maps alert changes to event types", () => {
    const alert = makeAlert();

    expect(toFleetEvent({ kind: "escalated", alert })).toEqual({ type: "alert.escalated", alert });
  });
});

describe("logFleetEvent", () => {
  it("logs alert changes but not robot updates", () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    logFleetEvent(logger, robotUpdated);
    logFleetEvent(logger, { type: "alert.opened", alert: makeAlert({ message: "Battery at 15%" }) });
    logFleetEvent(logger, { type: "alert.resolved", alert: makeAlert() });

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ type: "LOW_BATTERY" }), "alert.opened: Battery at 15%");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ type: "LOW_BATTERY" }), "alert resolved");
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();
  });
});
