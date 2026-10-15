import { describe, expect, it } from "vitest";
import { Sender, type Fetch } from "../../simulator/sender.ts";
import type { TelemetryInput } from "../../src/domain/telemetry.ts";
import { T0 } from "../fixtures.ts";

const batch = (robotId: string): TelemetryInput[] => [
  {
    robotId,
    siteId: "site-a",
    timestamp: new Date(T0).toISOString(),
    battery: 80,
    position: { x: 0, y: 0 },
    status: "moving",
  },
];

const ok = () =>
  new Response(JSON.stringify({ accepted: 1, late: 0, duplicates: 0, rejected: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fake server that answers with the given responses in order and records what it received. */
function fakeServer(...responses: (() => Response | Promise<never>)[]) {
  const received: string[] = [];
  const fetch: Fetch = async (_url, init) => {
    received.push((JSON.parse(init.body as string) as TelemetryInput[])[0]?.robotId ?? "?");
    const next = responses.shift() ?? ok;
    return next();
  };
  return { fetch, received };
}

const unreachable = () => Promise.reject(new Error("ECONNREFUSED"));
const sender = (fetch: Fetch, maxPendingBatches = 10) =>
  new Sender({ serverUrl: "http://server", maxPendingBatches, fetch, log: () => {} });

describe("Sender", () => {
  it("sends batches in order and adds up the server's summaries", async () => {
    const server = fakeServer();
    const subject = sender(server.fetch);

    subject.enqueue([batch("a"), batch("b")]);
    await subject.flush();

    expect(server.received).toEqual(["a", "b"]);
    expect(subject.stats).toMatchObject({ accepted: 2, failedRequests: 0 });
    expect(subject.pendingBatches).toBe(0);
  });

  it("keeps batches when the server is unreachable and retries them in order later", async () => {
    const server = fakeServer(unreachable);
    const subject = sender(server.fetch);

    subject.enqueue([batch("a"), batch("b")]);
    await subject.flush();
    expect(subject.pendingBatches).toBe(2);
    expect(subject.stats.failedRequests).toBe(1);

    await subject.flush();
    expect(server.received).toEqual(["a", "a", "b"]);
    expect(subject.pendingBatches).toBe(0);
  });

  it("retries after a server error", async () => {
    const server = fakeServer(() => new Response("oops", { status: 503 }));
    const subject = sender(server.fetch);

    subject.enqueue([batch("a")]);
    await subject.flush();
    await subject.flush();

    expect(server.received).toEqual(["a", "a"]);
    expect(subject.stats.accepted).toBe(1);
  });

  it("drops a batch the server rejects as invalid instead of retrying it forever", async () => {
    const server = fakeServer(() => new Response("{}", { status: 400 }));
    const subject = sender(server.fetch);

    subject.enqueue([batch("bad"), batch("good")]);
    await subject.flush();

    expect(server.received).toEqual(["bad", "good"]);
    expect(subject.stats).toMatchObject({ droppedBatches: 1, accepted: 1 });
  });

  it("drops the oldest batches beyond the queue limit", () => {
    const subject = sender(fakeServer().fetch, 2);

    subject.enqueue([batch("a"), batch("b"), batch("c")]);

    expect(subject.pendingBatches).toBe(2);
    expect(subject.stats.droppedBatches).toBe(1);
  });

  it("does not run two flushes at the same time", async () => {
    let release: () => void = () => {};
    const slow: Fetch = (_url, _init) =>
      new Promise((resolve) => {
        release = () => resolve(ok());
      });
    let calls = 0;
    const subject = sender((url, init) => {
      calls++;
      return slow(url, init);
    });

    subject.enqueue([batch("a")]);
    const first = subject.flush();
    await subject.flush();
    release();
    await first;

    expect(calls).toBe(1);
  });
});
