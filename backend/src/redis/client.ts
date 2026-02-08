import { createClient } from "redis";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const redisClient = createClient({
  url: env.REDIS_URL,
});

redisClient.on("error", (err) => {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    console.error("Redis error", err);
  }
});

