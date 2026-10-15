import { describe, expect, it } from "vitest";
import { telemetrySchema, type TelemetryInput } from "../../src/domain/telemetry.ts";

const valid: TelemetryInput = {
  robotId: "robot-1",
  siteId: "site-a",
  timestamp: "2026-01-01T12:00:00Z",
  battery: 80,
  position: { x: 1.5, y: -2 },
  status: "moving",
};

describe("telemetrySchema", () => {
  it("parses valid telemetry and converts the timestamp to epoch ms", () => {
    const telemetry = telemetrySchema.parse(valid);

    expect(telemetry.timestamp).toBe(Date.parse("2026-01-01T12:00:00Z"));
    expect(telemetry.battery).toBe(80);
  });

  it("accepts timestamps with a UTC offset", () => {
    const telemetry = telemetrySchema.parse({ ...valid, timestamp: "2026-01-01T13:00:00+01:00" });

    expect(telemetry.timestamp).toBe(Date.parse("2026-01-01T12:00:00Z"));
  });

  it("strips unknown fields instead of rejecting them", () => {
    const telemetry = telemetrySchema.parse({ ...valid, firmware: "2.1.0" });

    expect(telemetry).not.toHaveProperty("firmware");
  });

  it.each([
    ["battery above 100", { battery: 101 }],
    ["negative battery", { battery: -1 }],
    ["unknown status", { status: "flying" }],
    ["empty robotId", { robotId: "  " }],
    ["timestamp without offset", { timestamp: "2026-01-01T12:00:00" }],
    ["timestamp that is not a date", { timestamp: "yesterday" }],
    ["missing position", { position: undefined }],
  ])("rejects %s", (_name, override) => {
    const result = telemetrySchema.safeParse({ ...valid, ...override });

    expect(result.success).toBe(false);
  });
});
