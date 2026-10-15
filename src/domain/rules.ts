export type Rules = {
  /** Silence after which a robot is no longer considered online. */
  staleAfterMs: number;
  /** Silence after which a robot is considered offline and an alert is raised. */
  offlineAfterMs: number;
  /** How far in the future a robot timestamp may be before it is rejected. */
  maxClockSkewMs: number;
  battery: {
    warningBelow: number;
    criticalBelow: number;
    /** Higher than warningBelow (hysteresis) so the alert does not flap around the threshold. */
    recoverAbove: number;
  };
};

export const DEFAULT_RULES: Rules = {
  staleAfterMs: 5_000,
  offlineAfterMs: 30_000,
  maxClockSkewMs: 30_000,
  battery: {
    warningBelow: 20,
    criticalBelow: 10,
    recoverAbove: 25,
  },
};

/** Throws if the thresholds contradict each other. Returns the rules unchanged otherwise. */
export function validateRules(rules: Rules): Rules {
  const { warningBelow, criticalBelow, recoverAbove } = rules.battery;
  const problems = [
    rules.staleAfterMs < rules.offlineAfterMs ? null : "staleAfterMs must be lower than offlineAfterMs",
    criticalBelow < warningBelow ? null : "battery criticalBelow must be lower than warningBelow",
    warningBelow <= recoverAbove ? null : "battery recoverAbove must not be lower than warningBelow",
  ].filter((problem) => problem !== null);

  if (problems.length > 0) {
    throw new Error(`Invalid rules: ${problems.join("; ")}`);
  }
  return rules;
}
