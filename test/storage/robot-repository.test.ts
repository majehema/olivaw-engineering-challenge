import { beforeEach, describe, expect, it } from "vitest";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { RobotRepository } from "../../src/storage/robot-repository.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { makeRobotState, makeTelemetry, T0 } from "../fixtures.ts";

describe("RobotRepository", () => {
  let robots: RobotRepository;
  let telemetry: TelemetryRepository;

  beforeEach(() => {
    const db = openDatabase(IN_MEMORY);
    robots = new RobotRepository(db);
    telemetry = new TelemetryRepository(db);
  });

  it("returns nothing for an empty fleet", () => {
    expect(robots.loadAll()).toEqual([]);
  });

  it("loads each robot with its latest telemetry and last-seen time", () => {
    const first = makeTelemetry();
    const latest = makeTelemetry({ timestamp: T0 + 1_000, battery: 79 });
    telemetry.insert(first, T0);
    telemetry.insert(latest, T0 + 1_000);

    robots.save(makeRobotState({ lastTelemetry: first, lastSeenAt: T0 }));
    robots.save(makeRobotState({ lastTelemetry: latest, lastSeenAt: T0 + 5_000 }));

    expect(robots.loadAll()).toEqual([{ lastTelemetry: latest, lastSeenAt: T0 + 5_000 }]);
  });

  it("refuses a snapshot whose telemetry was never stored", () => {
    expect(() => robots.save(makeRobotState())).toThrow(/FOREIGN KEY/);
  });
});
