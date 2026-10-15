import type { TelemetryInput } from "../src/domain/telemetry.ts";
import type { Random } from "./random.ts";
import { SCENARIOS, SimulatedRobot, type Scenario } from "./robot.ts";

// One robot of each special scenario, the rest behave normally.
const SPECIAL_SCENARIOS: readonly Scenario[] = SCENARIOS.filter((scenario) => scenario !== "normal");

export type FleetOptions = {
  robotCount: number;
  sites: readonly string[];
  random: Random;
  now: number;
};

export function createFleet({ robotCount, sites, random, now }: FleetOptions): SimulatedRobot[] {
  return Array.from(
    { length: robotCount },
    (_, index) =>
      new SimulatedRobot({
        robotId: `robot-${String(index + 1).padStart(3, "0")}`,
        siteId: sites[index % sites.length] ?? "site-1",
        scenario: SPECIAL_SCENARIOS[index] ?? "normal",
        random,
        now,
      }),
  );
}

/** Groups messages by site, as a site gateway would, in chunks of at most `maxBatchSize`. */
export function batchBySite(messages: readonly TelemetryInput[], maxBatchSize: number): TelemetryInput[][] {
  const bySite = Map.groupBy(messages, (message) => message.siteId);
  return [...bySite.values()].flatMap((siteMessages) => chunk(siteMessages, maxBatchSize));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
