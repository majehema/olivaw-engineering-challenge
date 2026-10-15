import { connectivityAt, type Connectivity } from "./connectivity.ts";
import type { Rules } from "./rules.ts";
import type { Telemetry } from "./telemetry.ts";

/** The server's current view of one robot. */
export type RobotState = {
  robotId: string;
  siteId: string;
  /** Most recent telemetry by robot timestamp. */
  lastTelemetry: Telemetry;
  /** Server time (epoch ms) when the robot was last heard from. */
  lastSeenAt: number;
  connectivity: Connectivity;
};

export type IngestOutcome =
  | { kind: "applied"; state: RobotState }
  | { kind: "late"; state: RobotState }
  | { kind: "duplicate"; state: RobotState }
  | { kind: "rejected"; reason: string };

export function ingestTelemetry(
  current: RobotState | undefined,
  telemetry: Telemetry,
  now: number,
  rules: Rules,
): IngestOutcome {
  // A robot with a clock far ahead would otherwise freeze its snapshot:
  // every correct message after it would look "older" and be treated as late.
  if (telemetry.timestamp > now + rules.maxClockSkewMs) {
    return { kind: "rejected", reason: "timestamp is too far in the future" };
  }

  if (current === undefined || telemetry.timestamp > current.lastTelemetry.timestamp) {
    return {
      kind: "applied",
      state: {
        robotId: telemetry.robotId,
        siteId: telemetry.siteId,
        lastTelemetry: telemetry,
        lastSeenAt: now,
        connectivity: "online",
      },
    };
  }

  // Older or repeated data still proves the robot is alive,
  // but it must not roll the snapshot back in time.
  const state: RobotState = { ...current, lastSeenAt: now, connectivity: "online" };
  const kind = telemetry.timestamp === current.lastTelemetry.timestamp ? "duplicate" : "late";
  return { kind, state };
}

/** Rebuilds a robot's state from storage, e.g. after a restart. Connectivity is derived, never stored. */
export function restoreRobotState(
  lastTelemetry: Telemetry,
  lastSeenAt: number,
  now: number,
  rules: Rules,
): RobotState {
  return {
    robotId: lastTelemetry.robotId,
    siteId: lastTelemetry.siteId,
    lastTelemetry,
    lastSeenAt,
    connectivity: connectivityAt(lastSeenAt, now, rules),
  };
}

/** Returns the same object when connectivity is unchanged, so callers can detect transitions by reference. */
export function refreshConnectivity(state: RobotState, now: number, rules: Rules): RobotState {
  const connectivity = connectivityAt(state.lastSeenAt, now, rules);
  return connectivity === state.connectivity ? state : { ...state, connectivity };
}
