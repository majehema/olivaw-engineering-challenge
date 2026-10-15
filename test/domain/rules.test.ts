import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, validateRules, type Rules } from "../../src/domain/rules.ts";

const withBattery = (battery: Partial<Rules["battery"]>): Rules => ({
  ...DEFAULT_RULES,
  battery: { ...DEFAULT_RULES.battery, ...battery },
});

describe("validateRules", () => {
  it("accepts the default rules", () => {
    expect(validateRules(DEFAULT_RULES)).toBe(DEFAULT_RULES);
  });

  it("accepts a recovery threshold equal to the warning threshold (no hysteresis)", () => {
    expect(() => validateRules(withBattery({ recoverAbove: 20 }))).not.toThrow();
  });

  it.each<[string, Rules]>([
    ["stale is not before offline", { ...DEFAULT_RULES, staleAfterMs: 30_000 }],
    ["critical is not below warning", withBattery({ criticalBelow: 20 })],
    ["recovery is below warning", withBattery({ recoverAbove: 15 })],
  ])("rejects rules where %s", (_name, rules) => {
    expect(() => validateRules(rules)).toThrow(/Invalid rules/);
  });
});
