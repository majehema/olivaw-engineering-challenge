import type { TelemetryInput } from "../src/domain/telemetry.ts";
import { Buffered, Immediate, Intermittent, SkewedClock, type Delivery } from "./delivery.ts";
import { initialModel, PROFILES, step, type Profile, type RobotModel } from "./model.ts";
import type { Random } from "./random.ts";

export const SCENARIOS = ["normal", "silent", "laggy", "low-battery", "faulty", "skewed-clock"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type RobotOptions = {
  robotId: string;
  siteId: string;
  scenario: Scenario;
  random: Random;
  now: number;
};

// A simulated robot: its physics (battery, position, status) always advance,
// even while it is not transmitting; the scenario decides what reaches the server.
export class SimulatedRobot {
  readonly robotId: string;
  readonly siteId: string;
  readonly scenario: Scenario;
  private readonly random: Random;
  private readonly profile: Profile;
  private readonly delivery: Delivery;
  private model: RobotModel;
  private lastTickAt: number;

  constructor({ robotId, siteId, scenario, random, now }: RobotOptions) {
    this.robotId = robotId;
    this.siteId = siteId;
    this.scenario = scenario;
    this.random = random;
    this.profile = profileFor(scenario);
    this.delivery = deliveryFor(scenario, random, now);
    this.model = initialModel(random);
    this.lastTickAt = now;
  }

  /** Advances the robot to `now` and returns the messages it sends (none, one or several). */
  tick(now: number): TelemetryInput[] {
    this.model = step(this.model, (now - this.lastTickAt) / 1_000, this.profile, this.random);
    this.lastTickAt = now;
    return this.delivery.deliver(this.toMessage(now), now);
  }

  private toMessage(now: number): TelemetryInput {
    return {
      robotId: this.robotId,
      siteId: this.siteId,
      timestamp: new Date(now).toISOString(),
      battery: round(this.model.battery, 1),
      position: { x: round(this.model.x, 2), y: round(this.model.y, 2) },
      status: this.model.status,
    };
  }
}

function profileFor(scenario: Scenario): Profile {
  if (scenario === "low-battery") return PROFILES.lowBattery;
  if (scenario === "faulty") return PROFILES.faulty;
  return PROFILES.normal;
}

function deliveryFor(scenario: Scenario, random: Random, now: number): Delivery {
  switch (scenario) {
    case "silent":
      // 60 s online, then 45 s of silence: long enough to go stale, offline and come back.
      return new Intermittent(60_000, 45_000, now);
    case "laggy":
      // Flushes every 10 s: late, out-of-order and duplicate data, and "stale" between flushes.
      return new Buffered(10_000, now, random);
    case "skewed-clock":
      // Two minutes ahead: beyond the server's 30 s tolerance, so its messages are rejected.
      return new SkewedClock(120_000);
    default:
      return new Immediate();
  }
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
