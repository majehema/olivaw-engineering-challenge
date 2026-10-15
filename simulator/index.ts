import { loadSimulatorConfig } from "./config.ts";
import { batchBySite, createFleet } from "./fleet.ts";
import { seededRandom } from "./random.ts";
import { Sender } from "./sender.ts";

// The simulator plays the robots, a separate system: it shares only types with
// the server (erased at runtime), never server code. This mirrors the server's limit.
const MAX_BATCH_SIZE = 500;
const REPORT_EVERY_MS = 10_000;

const config = loadSimulatorConfig();
const log = (line: string) => console.log(`${new Date().toISOString()} [simulator] ${line}`);

const fleet = createFleet({
  robotCount: config.robotCount,
  sites: config.sites,
  random: seededRandom(config.seed),
  now: Date.now(),
});
// Five minutes of batches at one batch per site per tick.
const sender = new Sender({ serverUrl: config.serverUrl, maxPendingBatches: 300 * config.sites.length, log });

log(`${fleet.length} robots across ${config.sites.length} sites -> ${config.serverUrl} (seed ${config.seed})`);
for (const robot of fleet.filter((robot) => robot.scenario !== "normal")) {
  log(`  ${robot.robotId} @ ${robot.siteId}: ${robot.scenario}`);
}

const ticker = setInterval(() => {
  const now = Date.now();
  sender.enqueue(batchBySite(fleet.flatMap((robot) => robot.tick(now)), MAX_BATCH_SIZE));
  void sender.flush();
}, config.tickMs);

const reporter = setInterval(() => {
  const { accepted, late, duplicates, rejected, failedRequests, droppedBatches } = sender.stats;
  log(
    `accepted=${accepted} late=${late} duplicates=${duplicates} rejected=${rejected} ` +
      `failedRequests=${failedRequests} droppedBatches=${droppedBatches} queued=${sender.pendingBatches}`,
  );
}, REPORT_EVERY_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    clearInterval(ticker);
    clearInterval(reporter);
    log("stopping, sending queued batches");
    await sender.flush();
    process.exit(0);
  });
}
