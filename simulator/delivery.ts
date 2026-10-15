import type { TelemetryInput } from "../src/domain/telemetry.ts";
import { shuffle, type Random } from "./random.ts";

/** Decides which messages leave the robot on each tick: the network/firmware side of a scenario. */
export type Delivery = {
  deliver(message: TelemetryInput, now: number): TelemetryInput[];
};

/** Sends every message as soon as it is produced. */
export class Immediate implements Delivery {
  deliver(message: TelemetryInput): TelemetryInput[] {
    return [message];
  }
}

/** Sends for `onMs`, then goes completely silent for `offMs`, repeatedly. */
export class Intermittent implements Delivery {
  private readonly onMs: number;
  private readonly offMs: number;
  private readonly startedAt: number;

  constructor(onMs: number, offMs: number, startedAt: number) {
    this.onMs = onMs;
    this.offMs = offMs;
    this.startedAt = startedAt;
  }

  deliver(message: TelemetryInput, now: number): TelemetryInput[] {
    const phase = (now - this.startedAt) % (this.onMs + this.offMs);
    return phase < this.onMs ? [message] : [];
  }
}

/**
 * Buffers messages and flushes them every `flushEveryMs`, shuffled: they arrive
 * late and out of order. Each flush also repeats one message from the previous
 * flush, like a producer retrying a request whose response it never got.
 */
export class Buffered implements Delivery {
  private readonly flushEveryMs: number;
  private readonly random: Random;
  private lastFlushAt: number;
  private buffer: TelemetryInput[] = [];
  private previousFlush: TelemetryInput[] = [];

  constructor(flushEveryMs: number, startedAt: number, random: Random) {
    this.flushEveryMs = flushEveryMs;
    this.lastFlushAt = startedAt;
    this.random = random;
  }

  deliver(message: TelemetryInput, now: number): TelemetryInput[] {
    this.buffer.push(message);
    if (now - this.lastFlushAt < this.flushEveryMs) return [];

    const retried = this.previousFlush[Math.floor(this.random() * this.previousFlush.length)];
    const flushed = shuffle(this.buffer, this.random);
    this.previousFlush = this.buffer;
    this.buffer = [];
    this.lastFlushAt = now;
    return retried === undefined ? flushed : [...flushed, retried];
  }
}

/** Sends immediately, but the robot's clock is ahead of real time. */
export class SkewedClock implements Delivery {
  private readonly skewMs: number;

  constructor(skewMs: number) {
    this.skewMs = skewMs;
  }

  deliver(message: TelemetryInput): TelemetryInput[] {
    const timestamp = new Date(Date.parse(message.timestamp) + this.skewMs).toISOString();
    return [{ ...message, timestamp }];
  }
}
