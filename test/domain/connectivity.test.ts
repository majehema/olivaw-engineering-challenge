import { describe, expect, it } from "vitest";
import { connectivityAt } from "../../src/domain/connectivity.ts";
import { DEFAULT_RULES } from "../../src/domain/rules.ts";
import { T0 } from "../fixtures.ts";

describe("connectivityAt", () => {
  it.each([
    [0, "online"],
    [4_999, "online"],
    [5_000, "stale"],
    [29_999, "stale"],
    [30_000, "offline"],
    [3_600_000, "offline"],
  ])("after %i ms of silence the robot is %s", (silentForMs, expected) => {
    expect(connectivityAt(T0, T0 + silentForMs, DEFAULT_RULES)).toBe(expected);
  });
});
