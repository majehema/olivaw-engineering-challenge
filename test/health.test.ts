import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

describe("GET /health", () => {
  const app = buildApp({ logLevel: "silent" });
  afterAll(() => app.close());

  it("reports the service as healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});
