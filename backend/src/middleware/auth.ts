import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { loadEnv } from "../config/env";
import { redisClient } from "../redis/client";

const env = loadEnv();

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface TokenPayload extends AuthUser {
  jti: string;
  exp?: number;
}

export const signAccessToken = (user: AuthUser): string => {
  const jti = crypto.randomUUID();
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti },
    env.JWT_SECRET,
    { expiresIn: "1h" },
  );
};

export const blacklistToken = async (jti: string, ttlSeconds: number) => {
  const key = `jwt:blacklist:${jti}`;
  await redisClient.set(key, "1", { EX: ttlSeconds });
};

export const isTokenBlacklisted = async (jti: string): Promise<boolean> => {
  const key = `jwt:blacklist:${jti}`;
  const val = await redisClient.get(key);
  return val === "1";
};

export const requireAuth = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const cookies = request.cookies ?? {};
  let token = (cookies as { access_token?: string }).access_token;
  if (!token) {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      token = header.slice("Bearer ".length);
    }
  }

  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;

    if (decoded.jti && (await isTokenBlacklisted(decoded.jti))) {
      return reply.code(401).send({ error: "token_revoked" });
    }

    request.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    request.jti = decoded.jti;
    request.tokenExp = typeof decoded.exp === "number" ? decoded.exp : undefined;
  } catch {
    return reply.code(401).send({ error: "invalid_token" });
  }
};

export const optionalAuth = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const cookies = request.cookies ?? {};
  let token = (cookies as { access_token?: string }).access_token;
  if (!token) {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      token = header.slice("Bearer ".length);
    }
  }
  if (!token) return;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    if (decoded.jti && (await isTokenBlacklisted(decoded.jti))) return;
    request.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    request.jti = decoded.jti;
    request.tokenExp = typeof decoded.exp === "number" ? decoded.exp : undefined;
  } catch {
    // ignore invalid token
  }
};

export const requireAdmin = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  if (!request.user) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  if (request.user.role !== "admin") {
    return reply.code(403).send({ error: "forbidden" });
  }
};
