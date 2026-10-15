import type { FastifyReply } from "fastify";
import { z } from "zod";

/** Responds 400 with one entry per invalid field. */
export function badRequest(reply: FastifyReply, error: string, cause: z.ZodError) {
  return reply.code(400).send({
    error,
    issues: cause.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export function notFound(reply: FastifyReply, error: string) {
  return reply.code(404).send({ error });
}

/** Query-string limit: always bounded so a single request cannot read a whole table. */
export const limitSchema = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback);

/** ISO 8601 timestamp in a query string, converted to epoch ms. */
export const isoTimestampSchema = z.iso.datetime({ offset: true }).transform((value) => Date.parse(value));
