import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertService } from "../../src/application/alert-service.ts";
import { EventBus, type FleetEvent } from "../../src/application/event-bus.ts";
import { FleetStore } from "../../src/application/fleet-store.ts";
import { Watchdog } from "../../src/application/watchdog.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import type { RobotState } from "../../src/domain/fleet-state.ts";
import { AlertRepository } from "../../src/storage/alert-repository.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { makeAlert, makeRobotState, silentLogger, T0 } from "../fixtures.ts";

const rules = DEFAULT_RULES;
const GRACE_OVER = T0 + rules.offlineAfterMs;

/** A watchdog started at T0 watching the given robots. */
function setup(robots: RobotState[] = [makeRobotState()]) {
  const db = openDatabase(IN_MEMORY);
  const store = new FleetStore();
  robots.forEach((robot) => store.set(robot));
  const alertRepository = new AlertRepository(db);
  const clock = { now: T0 };
  const events = new EventBus(silentLogger);
  const published: FleetEvent[] = [];
  events.subscribe((event) => published.push(event));
  const watchdog = new Watchdog({
    db,
    store,
    alerts: new AlertService({ alerts: alertRepository, rules }),
    clock: () => clock.now,
    rules,
    events,
    logger: silentLogger,
  });
  const openAlertTypes = () => alertRepository.listOpen().map((alert) => alert.type);
  return { db, store, alertRepository, clock, watchdog, openAlertTypes, published };
}

describe("Watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a robot that keeps reporting alone", () => {
    const { watchdog, store, clock } = setup();
    const before = store.get("robot-1");
    clock.now = T0 + 1_000;

    watchdog.tick();

    expect(store.get("robot-1")).toBe(before);
  });

  it("marks a silent robot as stale, then offline with an alert", () => {
    const robot = makeRobotState({ lastSeenAt: GRACE_OVER });
    const { watchdog, store, clock, openAlertTypes } = setup([robot]);

    clock.now = GRACE_OVER + rules.staleAfterMs;
    watchdog.tick();
    expect(store.get("robot-1")?.connectivity).toBe("stale");
    expect(openAlertTypes()).toEqual([]);

    clock.now = GRACE_OVER + rules.offlineAfterMs;
    watchdog.tick();
    expect(store.get("robot-1")?.connectivity).toBe("offline");
    expect(openAlertTypes()).toEqual(["OFFLINE"]);
  });

  it("publishes connectivity changes and the alerts they cause", () => {
    const { watchdog, clock, published } = setup([makeRobotState({ lastSeenAt: GRACE_OVER })]);

    clock.now = GRACE_OVER + rules.staleAfterMs;
    watchdog.tick();
    clock.now = GRACE_OVER + rules.offlineAfterMs;
    watchdog.tick();
    watchdog.tick();

    expect(published.map((event) => (event.type === "robot.updated" ? event.robot.connectivity : event.type))).toEqual([
      "stale",
      "offline",
      "alert.opened",
    ]);
  });

  it("does not open the same OFFLINE alert twice", () => {
    const { watchdog, clock, alertRepository } = setup([makeRobotState({ lastSeenAt: GRACE_OVER })]);
    clock.now = GRACE_OVER + rules.offlineAfterMs;

    watchdog.tick();
    watchdog.tick();

    expect(alertRepository.list({ limit: 10 })).toHaveLength(1);
  });

  describe("startup grace period", () => {
    // Restored after downtime: last heard from five minutes before the server started.
    const restoredOffline = () => makeRobotState({ lastSeenAt: T0 - 300_000, connectivity: "offline" });

    it("does not raise OFFLINE alerts for robots that go silent during the grace period", () => {
      // Quick restart: last heard from 10 s before the server started, so it becomes offline 20 s after.
      const restoredStale = makeRobotState({ lastSeenAt: T0 - 10_000, connectivity: "stale" });
      const { watchdog, store, clock, openAlertTypes } = setup([restoredStale]);

      clock.now = T0 + 20_000;
      watchdog.tick();

      expect(store.get("robot-1")?.connectivity).toBe("offline");
      expect(openAlertTypes()).toEqual([]);
    });

    it("raises them once the grace period is over if the robot is still silent", () => {
      const { watchdog, clock, openAlertTypes } = setup([restoredOffline()]);
      watchdog.tick();

      clock.now = GRACE_OVER;
      watchdog.tick();

      expect(openAlertTypes()).toEqual(["OFFLINE"]);
    });

    it("keeps alerts that were already open before the restart", () => {
      const { watchdog, clock, alertRepository, openAlertTypes } = setup([restoredOffline()]);
      alertRepository.insert(makeAlert({ type: "OFFLINE", severity: "critical", openedAt: T0 - 270_000 }));

      clock.now = T0 + 1_000;
      watchdog.tick();

      expect(openAlertTypes()).toEqual(["OFFLINE"]);
    });
  });

  it("does not change memory when the database write fails", () => {
    const { watchdog, store, clock, db } = setup([makeRobotState({ lastSeenAt: GRACE_OVER })]);
    clock.now = GRACE_OVER + rules.offlineAfterMs;
    db.close();

    expect(() => watchdog.tick()).toThrow();
    expect(store.get("robot-1")?.connectivity).toBe("online");
  });

  it("ticks on an interval once started, and survives a failing tick", () => {
    vi.useFakeTimers();
    const { watchdog } = setup();
    const tick = vi.spyOn(watchdog, "tick").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    watchdog.start(1_000);
    vi.advanceTimersByTime(3_000);
    watchdog.stop();
    vi.advanceTimersByTime(3_000);

    expect(tick).toHaveBeenCalledTimes(3);
  });
});
