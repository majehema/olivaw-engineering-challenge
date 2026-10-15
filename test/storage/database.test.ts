import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IN_MEMORY, openDatabase } from "../../src/storage/database.ts";
import { migrate } from "../../src/storage/migrations.ts";
import { RobotRepository } from "../../src/storage/robot-repository.ts";
import { TelemetryRepository } from "../../src/storage/telemetry-repository.ts";
import { transaction } from "../../src/storage/transaction.ts";
import { makeRobotState, makeTelemetry, T0 } from "../fixtures.ts";

describe("openDatabase", () => {
  const tempDirs: string[] = [];
  afterEach(() => tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("creates the schema", () => {
    const db = openDatabase(IN_MEMORY);

    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toEqual(["alerts", "robots", "telemetry"]);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  });

  it("does not re-run migrations that were already applied", () => {
    const db = openDatabase(IN_MEMORY);

    expect(() => migrate(db)).not.toThrow();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
  });

  it("persists data across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-db-"));
    tempDirs.push(dir);
    const path = join(dir, "nested", "fleet.db");
    const telemetry = makeTelemetry();

    const first = openDatabase(path);
    new TelemetryRepository(first).insert(telemetry, T0);
    new RobotRepository(first).save(makeRobotState({ lastTelemetry: telemetry }));
    first.close();

    const second = openDatabase(path);
    expect(new RobotRepository(second).loadAll()).toEqual([{ lastTelemetry: telemetry, lastSeenAt: T0 }]);
    second.close();
  });
});

describe("transaction", () => {
  it("rolls back every write when the work throws", () => {
    const db = openDatabase(IN_MEMORY);
    const telemetry = new TelemetryRepository(db);

    expect(() =>
      transaction(db, () => {
        telemetry.insert(makeTelemetry(), T0);
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(telemetry.history("robot-1", { limit: 10 })).toEqual([]);
  });
});
