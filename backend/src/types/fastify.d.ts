import type { AuthUser } from "../middleware/auth";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    jti?: string;
    tokenExp?: number;
    apiUser?: { id: string; email: string };
    apiKeyId?: string;
  }
}
