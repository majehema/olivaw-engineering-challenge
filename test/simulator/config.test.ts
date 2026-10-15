import { describe, expect, it } from "vitest";
import { loadSimulatorConfig } from "../../simulator/config.ts";

describe("loadSimulatorConfig", () => {
  it("uses defaults", () => {
    expect(loadSimulatorConfig({ SEED: "7" })).toEqual({
      serverUrl: "http://localhost:3000",
      robotCount: 20,
      sites: ["warehouse-a", "warehouse-b", "warehouse-c"],
      tickMs: 1_000,
      seed: 7,
    });
  });

  it("reads the environment, trimming sites and the trailing slash of the URL", () => {
    const config = loadSimulatorConfig({
      SERVER_URL: "http://server:3000/",
      ROBOT_COUNT: "5",
      SITES: " north , south ,",
      TICK_MS: "500",
      SEED: "1",
    });

    expect(config).toEqual({ serverUrl: "http://server:3000", robotCount: 5, sites: ["north", "south"], tickMs: 500, seed: 1 });
  });

  it.each([
    ["ROBOT_COUNT", "0"],
    ["TICK_MS", "10"],
    ["SEED", "-1"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadSimulatorConfig({ [name]: value })).toThrow(`Invalid ${name}`);
  });

  it("rejects an empty site list", () => {
    expect(() => loadSimulatorConfig({ SITES: " , " })).toThrow(/SITES/);
  });
});
