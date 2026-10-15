import { beforeEach, describe, expect, it } from "vitest";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { makeTelemetry, T0 } from "../fixtures.ts";

describe("TelemetryRepository", () => {
  let repository: TelemetryRepository;

  beforeEach(() => {
    repository = new TelemetryRepository(openDatabase(IN_MEMORY));
  });

  it("stores telemetry and reads it back unchanged", () => {
    const telemetry = makeTelemetry({ battery: 42.5, position: { x: 1.25, y: -3 }, status: "charging" });

    expect(repository.insert(telemetry, T0)).toBe(true);
    expect(repository.history("robot-1", { limit: 10 })).toEqual([telemetry]);
  });

  it("ignores a message that was already stored", () => {
    repository.insert(makeTelemetry(), T0);

    expect(repository.insert(makeTelemetry({ battery: 10 }), T0 + 1_000)).toBe(false);
    expect(repository.history("robot-1", { limit: 10 })).toEqual([makeTelemetry()]);
  });

  describe("history", () => {
    beforeEach(() => {
      for (let second = 0; second < 5; second++) {
        repository.insert(makeTelemetry({ timestamp: T0 + second * 1_000 }), T0);
      }
      repository.insert(makeTelemetry({ robotId: "robot-2" }), T0);
    });

    const timestamps = (query: Parameters<TelemetryRepository["history"]>[1]) =>
      repository.history("robot-1", query).map((telemetry) => (telemetry.timestamp - T0) / 1_000);

    it("returns only the requested robot, newest first", () => {
      expect(timestamps({ limit: 10 })).toEqual([4, 3, 2, 1, 0]);
    });

    it("filters by an inclusive time range", () => {
      expect(timestamps({ from: T0 + 1_000, to: T0 + 3_000, limit: 10 })).toEqual([3, 2, 1]);
    });

    it("returns the most recent entries up to the limit", () => {
      expect(timestamps({ limit: 2 })).toEqual([4, 3]);
    });
  });
});
