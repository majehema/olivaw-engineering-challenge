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
