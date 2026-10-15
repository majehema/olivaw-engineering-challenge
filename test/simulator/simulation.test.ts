import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { batchBySite, createFleet } from "../../simulator/fleet.ts";
import { seededRandom } from "../../simulator/random.ts";
import { Sender, type Fetch } from "../../simulator/sender.ts";
import { buildApp } from "../../src/app.ts";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { T0 } from "../fixtures.ts";

// End to end without a network: the simulated fleet sends to the real app through inject().
describe("simulated fleet against the real server", () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it("exercises the server's rules: alerts, late data, duplicates and rejected timestamps", async () => {
    const clock = { now: T0 };
    app = buildApp({ db: openDatabase(IN_MEMORY), logLevel: "silent", clock: () => clock.now });
    const fetch: Fetch = async (url, init) => {
      const response = await app.inject({
        method: "POST",
        url: new URL(url).pathname,
        headers: { "content-type": "application/json" },
        payload: init.body as string,
      });
      return new Response(response.body, { status: response.statusCode });
    };
    const sender = new Sender({ serverUrl: "http://server", maxPendingBatches: 100, fetch, log: () => {} });
    const fleet = createFleet({ robotCount: 8, sites: ["site-a", "site-b"], random: seededRandom(1), now: T0 });

    for (let second = 1; second <= 180; second++) {
      clock.now = T0 + second * 1_000;
      sender.enqueue(batchBySite(fleet.flatMap((robot) => robot.tick(clock.now)), 500));
      await sender.flush();
    }

    expect(sender.stats.failedRequests).toBe(0);
    expect(sender.stats.late).toBeGreaterThan(0);
    expect(sender.stats.duplicates).toBeGreaterThan(0);
    expect(sender.stats.rejected).toBeGreaterThan(0);

    const alerts = (await app.inject({ method: "GET", url: "/alerts?limit=1000" })).json() as { type: string }[];
    const types = new Set(alerts.map((alert) => alert.type));
    expect(types).toContain("LOW_BATTERY");
    expect(types).toContain("ROBOT_ERROR");

    // The robot with the skewed clock never gets in: all its messages are rejected.
    const robots = (await app.inject({ method: "GET", url: "/robots" })).json() as unknown[];
    expect(robots).toHaveLength(7);
  });
});
