import type { Alert } from "../domain/alerts.ts";
import type { Connectivity } from "../domain/connectivity.ts";
import type { RobotState } from "../domain/fleet-state.ts";
import type { Telemetry } from "../domain/telemetry.ts";
import type { AlertQuery, AlertRepository } from "../storage/alert-repository.ts";
import type { HistoryQuery, TelemetryRepository } from "../storage/telemetry-repository.ts";
import type { FleetStore } from "./fleet-store.ts";

export type ConnectivityCounts = { total: number } & Record<Connectivity, number>;

export type FleetSummary = {
  robots: ConnectivityCounts;
  sites: ({ siteId: string } & ConnectivityCounts)[];
  alerts: { active: number; critical: number; warning: number };
};

export type RobotFilter = {
  siteId?: string;
  connectivity?: Connectivity;
};

export type FleetQueriesDependencies = {
  store: FleetStore;
  telemetry: TelemetryRepository;
  alerts: AlertRepository;
};

// Read side of the service. Current state comes from memory; history and
// alerts come from the database.
export class FleetQueries {
  private readonly deps: FleetQueriesDependencies;

  constructor(deps: FleetQueriesDependencies) {
    this.deps = deps;
  }

  summary(): FleetSummary {
    const robots = emptyCounts();
    const sites = new Map<string, ConnectivityCounts>();

    for (const robot of this.deps.store.all()) {
      count(robots, robot.connectivity);
      const site = sites.get(robot.siteId) ?? emptyCounts();
      count(site, robot.connectivity);
      sites.set(robot.siteId, site);
    }

    const openAlerts = this.deps.alerts.listOpen();
    return {
      robots,
      sites: [...sites]
        .map(([siteId, counts]) => ({ siteId, ...counts }))
        .sort((a, b) => a.siteId.localeCompare(b.siteId)),
      alerts: {
        active: openAlerts.length,
        critical: openAlerts.filter((alert) => alert.severity === "critical").length,
        warning: openAlerts.filter((alert) => alert.severity === "warning").length,
      },
    };
  }

  /** Robots matching the filter, sorted by id for a stable order. */
  robots(filter: RobotFilter = {}): RobotState[] {
    return this.deps.store
      .all()
      .filter((robot) => filter.siteId === undefined || robot.siteId === filter.siteId)
      .filter((robot) => filter.connectivity === undefined || robot.connectivity === filter.connectivity)
      .sort((a, b) => a.robotId.localeCompare(b.robotId));
  }

  robot(robotId: string): RobotState | undefined {
    return this.deps.store.get(robotId);
  }

  /** Open alerts grouped by robot, read with a single query. */
  openAlertsByRobot(): Map<string, Alert[]> {
    const byRobot = new Map<string, Alert[]>();
    for (const alert of this.deps.alerts.listOpen()) {
      const robotAlerts = byRobot.get(alert.robotId);
      if (robotAlerts === undefined) byRobot.set(alert.robotId, [alert]);
      else robotAlerts.push(alert);
    }
    return byRobot;
  }

  openAlertsFor(robotId: string): Alert[] {
    return this.deps.alerts.listOpenForRobot(robotId);
  }

  /** Undefined when the robot has never reported. */
  history(robotId: string, query: HistoryQuery): Telemetry[] | undefined {
    if (this.deps.store.get(robotId) === undefined) return undefined;
    return this.deps.telemetry.history(robotId, query);
  }

  alerts(query: AlertQuery): Alert[] {
    return this.deps.alerts.list(query);
  }
}

function emptyCounts(): ConnectivityCounts {
  return { total: 0, online: 0, stale: 0, offline: 0 };
}

function count(counts: ConnectivityCounts, connectivity: Connectivity): void {
  counts.total++;
  counts[connectivity]++;
}
