export interface Env {
  PORT: number;
  DATABASE_URL: string;
  DATABASE_READ_URL?: string;
  DB_POOL_MAX?: number;
  REDIS_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS: string[];
  KAFKA_BROKERS?: string;
}

export const loadEnv = (): Env => {
  const {
    PORT = "3001",
    DATABASE_URL,
    DATABASE_READ_URL,
    DB_POOL_MAX,
    REDIS_URL = "redis://localhost:6379",
    JWT_SECRET,
    CORS_ORIGINS = "http://localhost:5173,http://localhost:3000",
    KAFKA_BROKERS,
  } = process.env;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }

  return {
    PORT: Number(PORT),
    DATABASE_URL,
    DATABASE_READ_URL,
    DB_POOL_MAX: DB_POOL_MAX != null ? Number(DB_POOL_MAX) : undefined,
    REDIS_URL,
    JWT_SECRET,
    CORS_ORIGINS: CORS_ORIGINS.split(",").map((origin) => origin.trim()),
    KAFKA_BROKERS: KAFKA_BROKERS ?? undefined,
  };
};

