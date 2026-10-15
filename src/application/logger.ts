import type { FastifyBaseLogger } from "fastify";

/** The subset of Fastify's (Pino) logger the application layer uses. */
export type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;
