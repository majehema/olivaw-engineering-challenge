import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./storage/database.ts";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = buildApp({ db, logLevel: config.logLevel });

// Graceful shutdown: stop accepting connections, let in-flight requests finish,
// then close the database so no write is cut in half.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    db.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, "failed to start server");
  db.close();
  process.exit(1);
}
