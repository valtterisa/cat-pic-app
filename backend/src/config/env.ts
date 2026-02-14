export interface Env {
  PORT: number;
  DATABASE_URL: string;
  DB_POOL_MAX?: number;
  REDIS_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS: string[];
  MONGODB_URI: string;
}

export const loadEnv = (): Env => {
  const {
    PORT = "3001",
    DATABASE_URL,
    DB_POOL_MAX,
    REDIS_URL = "redis://localhost:6379",
    JWT_SECRET,
    CORS_ORIGINS = "http://localhost:5173,http://localhost:3000",
    MONGODB_URI,
  } = process.env;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  return {
    PORT: Number(PORT),
    DATABASE_URL,
    DB_POOL_MAX: DB_POOL_MAX != null ? Number(DB_POOL_MAX) : undefined,
    REDIS_URL,
    JWT_SECRET,
    CORS_ORIGINS: CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    MONGODB_URI,
  };
};

