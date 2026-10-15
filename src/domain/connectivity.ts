import type { Rules } from "./rules.ts";

export type Connectivity = "online" | "stale" | "offline";

// Measured with the server clock: a robot's own clock may be wrong, and
// "when did we last hear from it" is a question about the server's view.
export function connectivityAt(lastSeenAt: number, now: number, rules: Rules): Connectivity {
  const silentForMs = now - lastSeenAt;
  if (silentForMs < rules.staleAfterMs) return "online";
  if (silentForMs < rules.offlineAfterMs) return "stale";
  return "offline";
}
