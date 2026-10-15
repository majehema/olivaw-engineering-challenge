import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./transaction.ts";

// Each entry upgrades the schema by one version; PRAGMA user_version records
// how many have been applied. Append new migrations, never edit a shipped one.
const MIGRATIONS: readonly string[] = [
  `
  -- Append-only history. The natural key makes producer retries idempotent.
  CREATE TABLE telemetry (
    robot_id     TEXT    NOT NULL,
    site_id      TEXT    NOT NULL,
    ts           INTEGER NOT NULL, -- robot clock, epoch ms
    received_at  INTEGER NOT NULL, -- server clock, epoch ms
    battery      REAL    NOT NULL,
    pos_x        REAL    NOT NULL,
    pos_y        REAL    NOT NULL,
    status       TEXT    NOT NULL,
    PRIMARY KEY (robot_id, ts)
  ) WITHOUT ROWID;

  -- One row per robot pointing at its latest telemetry, so rebuilding the
  -- in-memory state on startup costs O(robots) instead of scanning history.
  CREATE TABLE robots (
    robot_id      TEXT    PRIMARY KEY,
    site_id       TEXT    NOT NULL,
    last_ts       INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL, -- server clock, epoch ms
    FOREIGN KEY (robot_id, last_ts) REFERENCES telemetry (robot_id, ts)
  );

  CREATE TABLE alerts (
    id           TEXT    PRIMARY KEY,
    robot_id     TEXT    NOT NULL,
    type         TEXT    NOT NULL,
    severity     TEXT    NOT NULL,
    message      TEXT    NOT NULL,
    opened_at    INTEGER NOT NULL,
    resolved_at  INTEGER
  );

  -- Enforces the domain invariant in the database too: at most one open alert per robot and type.
  CREATE UNIQUE INDEX alerts_one_open_per_type ON alerts (robot_id, type) WHERE resolved_at IS NULL;
  CREATE INDEX alerts_by_opened_at ON alerts (opened_at);
  `,
];

export function migrate(db: DatabaseSync): void {
  const { user_version: applied } = db.prepare("PRAGMA user_version").get() as { user_version: number };

  MIGRATIONS.slice(applied).forEach((sql, index) => {
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${applied + index + 1}`);
    });
  });
}
