import { describe, expect, it } from "vitest";
import { AREA_SIZE, PROFILES, step, type Profile, type RobotModel } from "../../simulator/model.ts";
import { seededRandom } from "../../simulator/random.ts";

const robot = (overrides: Partial<RobotModel> = {}): RobotModel => ({
  battery: 80,
  x: 50,
  y: 50,
  heading: 0,
  status: "moving",
  ...overrides,
});

/** Runs the model for `seconds` one-second steps, returning every state. */
function run(start: RobotModel, seconds: number, profile: Profile, seed = 1): RobotModel[] {
  const random = seededRandom(seed);
  const states = [start];
  for (let i = 0; i < seconds; i++) states.push(step(states[i] as RobotModel, 1, profile, random));
  return states;
}

describe("step", () => {
  it("drains the battery while the robot works", () => {
    const [, after] = run(robot(), 1, PROFILES.normal);

    expect(after?.battery).toBeLessThan(80);
  });

  it("goes to charge below its threshold and leaves the charger when full", () => {
    const states = run(robot({ battery: 6 }), 120, PROFILES.lowBattery);
    const statuses = states.map((state) => state.status);

    expect(statuses).toContain("charging");
    expect(statuses.slice(statuses.indexOf("charging"))).toContain("idle");
    expect(Math.max(...states.map((state) => state.battery))).toBe(100);
  });

  it("a normal robot never drops below the warning threshold", () => {
    const states = run(robot({ battery: 30 }), 3_600, PROFILES.normal);

    expect(Math.min(...states.map((state) => state.battery))).toBeGreaterThan(20);
  });

  it("the low-battery profile goes through warning and critical levels", () => {
    const batteries = run(robot({ battery: 100 }), 120, PROFILES.lowBattery).map((state) => state.battery);

    expect(batteries.some((battery) => battery < 10)).toBe(true);
  });

  it("stays inside the site", () => {
    const states = run(robot(), 2_000, PROFILES.normal);

    for (const { x, y } of states) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(AREA_SIZE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(AREA_SIZE);
    }
  });

  it("a faulty robot reports errors and recovers from them", () => {
    const statuses = run(robot(), 300, PROFILES.faulty).map((state) => state.status);
    const firstError = statuses.indexOf("error");

    expect(firstError).toBeGreaterThan(-1);
    expect(statuses.slice(firstError).some((status) => status !== "error")).toBe(true);
  });

  it("is deterministic for a given seed", () => {
    expect(run(robot(), 100, PROFILES.faulty, 42)).toEqual(run(robot(), 100, PROFILES.faulty, 42));
  });
});
