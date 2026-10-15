import { describe, expect, it } from "vitest";
import { Buffered, Intermittent, SkewedClock } from "../../simulator/delivery.ts";
import { seededRandom } from "../../simulator/random.ts";
import type { TelemetryInput } from "../../src/domain/telemetry.ts";
import { T0 } from "../fixtures.ts";

const at = (second: number): TelemetryInput => ({
  robotId: "robot-1",
  siteId: "site-a",
  timestamp: new Date(T0 + second * 1_000).toISOString(),
  battery: 80,
  position: { x: 0, y: 0 },
  status: "moving",
});

const seconds = (messages: TelemetryInput[]) => messages.map((m) => (Date.parse(m.timestamp) - T0) / 1_000);

describe("Intermittent", () => {
  it("sends during the on period and nothing during the off period, repeatedly", () => {
    const delivery = new Intermittent(3_000, 2_000, T0);

    const sent = [0, 1, 2, 3, 4, 5, 6].map((second) => delivery.deliver(at(second), T0 + second * 1_000).length);

    expect(sent).toEqual([1, 1, 1, 0, 0, 1, 1]);
  });
});

describe("Buffered", () => {
  it("holds messages and flushes them all, shuffled, once the interval has passed", () => {
    const delivery = new Buffered(3_000, T0, seededRandom(7));

    expect(delivery.deliver(at(1), T0 + 1_000)).toEqual([]);
    expect(delivery.deliver(at(2), T0 + 2_000)).toEqual([]);
    const flushed = delivery.deliver(at(3), T0 + 3_000);

    expect(seconds(flushed).sort()).toEqual([1, 2, 3]);
  });

  it("repeats one message from the previous flush, like a retry", () => {
    const delivery = new Buffered(2_000, T0, seededRandom(7));
    delivery.deliver(at(1), T0 + 1_000);
    const first = seconds(delivery.deliver(at(2), T0 + 2_000));

    delivery.deliver(at(3), T0 + 3_000);
    const second = seconds(delivery.deliver(at(4), T0 + 4_000));

    expect(second).toHaveLength(3);
    expect(second.slice(0, 2).sort()).toEqual([3, 4]);
    expect(first).toContain(second[2]);
  });
});

describe("SkewedClock", () => {
  it("shifts the timestamp by the skew", () => {
    const [message] = new SkewedClock(120_000).deliver(at(0));

    expect(message?.timestamp).toBe(new Date(T0 + 120_000).toISOString());
  });
});
