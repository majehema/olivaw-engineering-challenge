import type { DatabaseSync } from "node:sqlite";

/** Runs `work` atomically: commits if it returns, rolls back if it throws. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
