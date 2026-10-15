export type SimulatorConfig = {
  serverUrl: string;
  robotCount: number;
  sites: string[];
  tickMs: number;
  /** Fixed seed for a reproducible run; random when not set. */
  seed: number;
};

export function loadSimulatorConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const sites = (env.SITES ?? "warehouse-a,warehouse-b,warehouse-c")
    .split(",")
    .map((site) => site.trim())
    .filter((site) => site.length > 0);
  if (sites.length === 0) throw new Error("SITES must list at least one site");

  return {
    serverUrl: (env.SERVER_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    robotCount: integer("ROBOT_COUNT", env.ROBOT_COUNT, 20, 1, 10_000),
    sites,
    tickMs: integer("TICK_MS", env.TICK_MS, 1_000, 100, 60_000),
    seed: integer("SEED", env.SEED, Math.floor(Math.random() * 2 ** 31), 0, 2 ** 31),
  };
}

function integer(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return parsed;
}
