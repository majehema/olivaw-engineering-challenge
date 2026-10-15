import { restoreRobotState, type RobotState } from "../domain/fleet-state.ts";
import type { Rules } from "../domain/rules.ts";
import type { StoredRobot } from "../storage/robot-repository.ts";

// The current state of every robot, held in memory. It answers "what is the
// fleet doing right now?" without touching the database. Node runs this code
// on a single thread, so the Map needs no locking.
export class FleetStore {
  private readonly robots = new Map<string, RobotState>();

  static restore(stored: readonly StoredRobot[], now: number, rules: Rules): FleetStore {
    const store = new FleetStore();
    for (const { lastTelemetry, lastSeenAt } of stored) {
      store.set(restoreRobotState(lastTelemetry, lastSeenAt, now, rules));
    }
    return store;
  }

  get(robotId: string): RobotState | undefined {
    return this.robots.get(robotId);
  }

  set(state: RobotState): void {
    this.robots.set(state.robotId, state);
  }

  all(): RobotState[] {
    return [...this.robots.values()];
  }
}
