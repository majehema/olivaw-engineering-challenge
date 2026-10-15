import { describe, expect, it } from "vitest";
import { ingestTelemetry, refreshConnectivity, restoreRobotState } from "../../src/domain/fleet-state.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import { makeRobotState, makeTelemetry, T0 } from "../fixtures.ts";

const rules = DEFAULT_RULES;

describe("ingestTelemetry", () => {
  it("creates the state from a robot's first message", () => {
    const telemetry = makeTelemetry();

    const outcome = ingestTelemetry(undefined, telemetry, T0, rules);

    expect(outcome).toEqual({
      kind: "applied",
      state: {
        robotId: "robot-1",
        siteId: "site-a",
        lastTelemetry: telemetry,
        lastSeenAt: T0,
        connectivity: "online",
      },
    });
  });

  it("replaces the snapshot with newer telemetry", () => {
    const current = makeRobotState();
    const newer = makeTelemetry({ timestamp: T0 + 1_000, battery: 79 });

    const outcome = ingestTelemetry(current, newer, T0 + 1_000, rules);

    expect(outcome.kind).toBe("applied");
    expect(outcome.kind === "applied" && outcome.state.lastTelemetry).toBe(newer);
  });

  it("keeps the snapshot for late data but marks the robot as seen", () => {
    const current = makeRobotState({ connectivity: "offline" });
    const older = makeTelemetry({ timestamp: T0 - 10_000, battery: 95 });
    const now = T0 + 60_000;

    const outcome = ingestTelemetry(current, older, now, rules);

    expect(outcome).toEqual({
      kind: "late",
      state: { ...current, lastSeenAt: now, connectivity: "online" },
    });
  });

  it("recognises a repeated message as a duplicate", () => {
    const current = makeRobotState();

    const outcome = ingestTelemetry(current, makeTelemetry(), T0 + 500, rules);

    expect(outcome.kind).toBe("duplicate");
    expect(outcome.kind === "duplicate" && outcome.state.lastTelemetry).toBe(current.lastTelemetry);
  });

  it("rejects timestamps beyond the allowed clock skew", () => {
    const future = makeTelemetry({ timestamp: T0 + rules.maxClockSkewMs + 1 });

    const outcome = ingestTelemetry(undefined, future, T0, rules);

    expect(outcome.kind).toBe("rejected");
  });

  it("accepts timestamps slightly ahead within the allowed clock skew", () => {
    const ahead = makeTelemetry({ timestamp: T0 + rules.maxClockSkewMs });

    expect(ingestTelemetry(undefined, ahead, T0, rules).kind).toBe("applied");
  });
});

describe("restoreRobotState", () => {
  it("derives connectivity from how long ago the robot was last seen", () => {
    const telemetry = makeTelemetry();

    expect(restoreRobotState(telemetry, T0, T0 + 1_000, rules).connectivity).toBe("online");
    expect(restoreRobotState(telemetry, T0, T0 + 60_000, rules)).toEqual({
      robotId: "robot-1",
      siteId: "site-a",
      lastTelemetry: telemetry,
      lastSeenAt: T0,
      connectivity: "offline",
    });
  });
});

describe("refreshConnectivity", () => {
  it("returns the same object when connectivity is unchanged", () => {
    const state = makeRobotState();

    expect(refreshConnectivity(state, T0 + 1_000, rules)).toBe(state);
  });

  it("returns an updated copy when connectivity changes", () => {
    const state = makeRobotState();

    const refreshed = refreshConnectivity(state, T0 + 30_000, rules);

    expect(refreshed).not.toBe(state);
    expect(refreshed.connectivity).toBe("offline");
    expect(state.connectivity).toBe("online");
  });
});
