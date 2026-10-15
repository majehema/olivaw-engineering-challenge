import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("uses defaults when no environment variables are set", () => {
    expect(loadConfig({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
      logLevel: "info",
      databasePath: "data/fleet.db",
    });
  });

  it("reads values from the environment", () => {
    const config = loadConfig({
      HOST: "127.0.0.1",
      PORT: "8080",
      LOG_LEVEL: "debug",
      DATABASE_PATH: "/var/lib/fleet/fleet.db",
    });

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8080,
      logLevel: "debug",
      databasePath: "/var/lib/fleet/fleet.db",
    });
  });

  it.each(["abc", "0", "70000", "3000.5"])("rejects invalid port %s", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid PORT/);
  });
});
