import { DEFAULT_RULES, validateRules, type Rules } from "./domain/rules.ts";

export type Config = {
  host: string;
  port: number;
  logLevel: string;
  databasePath: string;
  watchdogIntervalMs: number;
  rules: Rules;
};

// Invalid values fail at startup with a clear message instead of misbehaving later.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const integer = (name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
    parseInteger(name, env[name], fallback, min, max);
  const percentage = (name: string, fallback: number) => integer(name, fallback, 0, 100);

  return {
    // 0.0.0.0 so the server is reachable from outside a container.
    host: env.HOST ?? "0.0.0.0",
    port: integer("PORT", 3000, 1, 65535),
    logLevel: env.LOG_LEVEL ?? "info",
    databasePath: env.DATABASE_PATH ?? "data/fleet.db",
    watchdogIntervalMs: integer("WATCHDOG_INTERVAL_MS", 1_000),
    rules: validateRules({
      staleAfterMs: integer("STALE_AFTER_MS", DEFAULT_RULES.staleAfterMs),
      offlineAfterMs: integer("OFFLINE_AFTER_MS", DEFAULT_RULES.offlineAfterMs),
      maxClockSkewMs: integer("MAX_CLOCK_SKEW_MS", DEFAULT_RULES.maxClockSkewMs, 0),
      battery: {
        warningBelow: percentage("BATTERY_WARNING_PCT", DEFAULT_RULES.battery.warningBelow),
        criticalBelow: percentage("BATTERY_CRITICAL_PCT", DEFAULT_RULES.battery.criticalBelow),
        recoverAbove: percentage("BATTERY_RECOVERY_PCT", DEFAULT_RULES.battery.recoverAbove),
      },
    }),
  };
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return parsed;
}
