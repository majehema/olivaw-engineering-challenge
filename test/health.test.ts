import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { IN_MEMORY, openDatabase } from "../src/storage/database.ts";

describe("GET /health", () => {
  const db = openDatabase(IN_MEMORY);
  const app = buildApp({ db, logLevel: "silent" });
  afterAll(() => app.close());

  it("reports the service as healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", database: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    db.close();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", database: "unreachable" });
  });
});
