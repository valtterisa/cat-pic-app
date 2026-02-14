import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { authRoutes } from "./modules/auth/routes";
import { apiKeysRoutes } from "./modules/api-keys/routes";
import { quotesRoutes } from "./modules/quotes/routes";
import { apiRateLimit, authRateLimit } from "./middleware/rate-limit";
import { errorHandler } from "./middleware/error";
import { loadEnv } from "./config/env";

export const createApp = () => {
  const env = loadEnv();
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 1024 * 1024 });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      const parsed = body && body.length > 0 ? JSON.parse(body as string) : {};
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler(errorHandler);

  app.register(helmet);
  app.register(cookie);
  app.register(cors, {
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-CSRF-Token"],
  });

  const apiBase = process.env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;
  app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Motivational Quotes API",
        description: "Same base path: public (GET /api/v1/quotes, /api/v1/quotes/random) use X-API-Key; feed and dashboard use cookie auth.",
        version: "1.0.0",
      },
      servers: [
        { url: apiBase.replace(/\/$/, ""), description: "API server" },
        { url: "/", description: "Current origin" },
      ],
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  app.get("/health", {
    schema: {
      tags: ["Health"],
      response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
    },
  }, async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.register(
    async (instance) => {
      instance.addHook("preHandler", authRateLimit);
      instance.register(authRoutes);
    },
    { prefix: "/auth" },
  );

  app.register(apiKeysRoutes, { prefix: "/dashboard/api-keys" });

  app.register(
    async (instance) => {
      instance.addHook("preHandler", apiRateLimit);
      instance.register(quotesRoutes);
    },
    { prefix: "/api/v1" },
  );

  return app;
};
