import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { runMigrations } from "./db/migrate";
import { redisClient } from "./redis/client";

const env = loadEnv();
const app = createApp();

const startServer = async () => {
  try {
    await runMigrations();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Migrations failed:", err);
    process.exit(1);
  }

  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Redis connection failed, continuing without cache:", err);
  }

  app.listen(env.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`backend listening on http://localhost:${env.PORT}`);
  });
};

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});


