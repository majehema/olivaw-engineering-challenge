import type { RobotStatus } from "../src/domain/telemetry.ts";
import type { Random } from "./random.ts";

/** Each site is a square area, in metres. */
export const AREA_SIZE = 100;
const SPEED_METRES_PER_SECOND = 1;

export type RobotModel = {
  battery: number;
  x: number;
  y: number;
  /** Direction of travel, in radians. */
  heading: number;
  status: RobotStatus;
};

/** How a robot's hardware behaves. Probabilities are per second. */
export type Profile = {
  /** Battery % used per second while moving; idle robots use a third of it. */
  drainPerSecond: number;
  chargePerSecond: number;
  /** The robot goes to charge at this level... */
  chargeBelow: number;
  /** ...and leaves the charger at this one. */
  chargedAbove: number;
  faultPerSecond: number;
  recoverPerSecond: number;
};

export const PROFILES = {
  // Goes to charge at 25%, before the 20% warning: a healthy robot raises no alerts.
  normal: {
    drainPerSecond: 0.05,
    chargePerSecond: 0.5,
    chargeBelow: 25,
    chargedAbove: 95,
    faultPerSecond: 0,
    recoverPerSecond: 0,
  },
  // Drains in about a minute and only charges at 5%: warning, then critical, then recovery.
  lowBattery: {
    drainPerSecond: 2,
    chargePerSecond: 3,
    chargeBelow: 5,
    chargedAbove: 100,
    faultPerSecond: 0,
    recoverPerSecond: 0,
  },
  // A fault roughly every 30 s, lasting about 10 s.
  faulty: {
    drainPerSecond: 0.05,
    chargePerSecond: 0.5,
    chargeBelow: 25,
    chargedAbove: 95,
    faultPerSecond: 1 / 30,
    recoverPerSecond: 1 / 10,
  },
} satisfies Record<string, Profile>;

export function initialModel(random: Random): RobotModel {
  return {
    battery: 40 + random() * 60,
    x: random() * AREA_SIZE,
    y: random() * AREA_SIZE,
    heading: random() * 2 * Math.PI,
    status: "idle",
  };
}

/** Advances the robot's physical state by `seconds`. Pure: randomness is injected. */
export function step(model: RobotModel, seconds: number, profile: Profile, random: Random): RobotModel {
  const happens = (perSecond: number) => random() < perSecond * seconds;

  switch (model.status) {
    case "charging": {
      const battery = Math.min(100, model.battery + profile.chargePerSecond * seconds);
      return { ...model, battery, status: battery >= profile.chargedAbove ? "idle" : "charging" };
    }
    case "error":
      return happens(profile.recoverPerSecond) ? { ...model, status: "idle" } : model;
    case "idle":
    case "moving": {
      if (model.battery <= profile.chargeBelow) return { ...model, status: "charging" };
      if (happens(profile.faultPerSecond)) return { ...model, status: "error" };

      // Mostly moving: start or stop now and then.
      const status = happens(model.status === "moving" ? 0.05 : 0.2)
        ? model.status === "moving"
          ? "idle"
          : "moving"
        : model.status;
      const drain = profile.drainPerSecond * seconds * (status === "moving" ? 1 : 1 / 3);
      const moved = status === "moving" ? move(model, seconds, random) : model;
      return { ...moved, battery: Math.max(0, model.battery - drain), status };
    }
  }
}

/** Random walk that turns around at the edges of the site. */
function move(model: RobotModel, seconds: number, random: Random): RobotModel {
  let heading = model.heading + (random() - 0.5) * 0.6;
  let x = model.x + Math.cos(heading) * SPEED_METRES_PER_SECOND * seconds;
  let y = model.y + Math.sin(heading) * SPEED_METRES_PER_SECOND * seconds;

  if (x < 0 || x > AREA_SIZE || y < 0 || y > AREA_SIZE) {
    x = clamp(x, 0, AREA_SIZE);
    y = clamp(y, 0, AREA_SIZE);
    heading += Math.PI;
  }
  return { ...model, x, y, heading };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
