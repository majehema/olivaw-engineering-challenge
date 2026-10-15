import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.ts";

export const IN_MEMORY = ":memory:";

// https://nodejs.org/api/sqlite.html
export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  // WAL makes frequent small writes cheaper and lets other processes
  // (e.g. the sqlite3 CLI) read while the server writes.
  // https://www.sqlite.org/wal.html
  db.exec("PRAGMA journal_mode = WAL");
  // Safe with WAL: a power loss may drop the last commits but cannot corrupt the file.
  db.exec("PRAGMA synchronous = NORMAL");

  migrate(db);
  return db;
}
