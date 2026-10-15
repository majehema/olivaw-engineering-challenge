export type Config = {
  host: string;
  port: number;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    // 0.0.0.0 so the server is reachable from outside a container.
    host: env.HOST ?? "0.0.0.0",
    port: parsePort(env.PORT ?? "3000"),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: "${value}"`);
  }
  return port;
}
