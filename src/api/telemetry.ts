import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { IngestionService } from "../application/ingestion-service.ts";
import { telemetrySchema } from "../domain/telemetry.ts";
import { badRequest } from "./validation.ts";

export const MAX_BATCH_SIZE = 500;

// Accepts a single message or a batch; a single message is wrapped in an array.
const ingestBodySchema = z.preprocess(
  (body) => (Array.isArray(body) ? body : [body]),
  z.array(telemetrySchema).min(1).max(MAX_BATCH_SIZE),
);

export type TelemetryRoutesOptions = {
  ingestion: IngestionService;
};

export const telemetryRoutes: FastifyPluginAsync<TelemetryRoutesOptions> = async (app, { ingestion }) => {
  app.post("/telemetry", async (request, reply) => {
    const parsed = ingestBodySchema.safeParse(request.body);

    // A malformed payload is a producer bug, so the whole request is rejected
    // loudly instead of silently dropping the invalid messages.
    if (!parsed.success) return badRequest(reply, "Invalid telemetry", parsed.error);

    return ingestion.ingest(parsed.data);
  });
};
