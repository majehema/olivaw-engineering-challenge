import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_RULES } from "../src/domain/rules.ts";

describe("loadConfig", () => {
  it("uses defaults when no environment variables are set", () => {
    expect(loadConfig({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
      logLevel: "info",
      databasePath: "data/fleet.db",
      watchdogIntervalMs: 1_000,
      rules: DEFAULT_RULES,
    });
  });

  it("reads values from the environment", () => {
    const config = loadConfig({
      HOST: "127.0.0.1",
      PORT: "8080",
      LOG_LEVEL: "debug",
      DATABASE_PATH: "/var/lib/fleet/fleet.db",
      WATCHDOG_INTERVAL_MS: "500",
      STALE_AFTER_MS: "10000",
      OFFLINE_AFTER_MS: "60000",
      MAX_CLOCK_SKEW_MS: "0",
      BATTERY_WARNING_PCT: "30",
      BATTERY_CRITICAL_PCT: "15",
      BATTERY_RECOVERY_PCT: "35",
    });

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8080,
      logLevel: "debug",
      databasePath: "/var/lib/fleet/fleet.db",
      watchdogIntervalMs: 500,
      rules: {
        staleAfterMs: 10_000,
        offlineAfterMs: 60_000,
        maxClockSkewMs: 0,
        battery: { warningBelow: 30, criticalBelow: 15, recoverAbove: 35 },
      },
    });
  });

  it.each(["abc", "0", "70000", "3000.5", ""])("rejects invalid port %j", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid PORT/);
  });

  it.each([
    ["BATTERY_WARNING_PCT", "101"],
    ["OFFLINE_AFTER_MS", "-1"],
    ["WATCHDOG_INTERVAL_MS", "0"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(`Invalid ${name}`);
  });

  it("rejects thresholds that contradict each other", () => {
    expect(() => loadConfig({ STALE_AFTER_MS: "60000" })).toThrow(/Invalid rules/);
  });
});
