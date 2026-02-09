import type { FastifyRequest, FastifyReply } from "fastify";
import { redisClient } from "../redis/client";
import { loadEnv } from "../config/env";

const env = loadEnv();
const CSRF_TOKEN_COOKIE_NAME = "csrf_token";
const CSRF_TOKEN_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_TTL_SEC = 60 * 60 * 24;

const generateCsrfToken = (): string => {
  return crypto.randomUUID();
};

export const generateCsrfTokenCookie = async (
  reply: FastifyReply,
  userId?: string,
): Promise<string> => {
  const token = generateCsrfToken();
  const key = userId ? `csrf:${userId}:${token}` : `csrf:anonymous:${token}`;
  
  if (redisClient.isOpen) {
    try {
      await redisClient.set(key, "1", { EX: CSRF_TOKEN_TTL_SEC });
    } catch {
    }
  }

  const isProduction = process.env.NODE_ENV === "production";
  reply.setCookie(CSRF_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: CSRF_TOKEN_TTL_SEC,
  });

  return token;
};

export const validateCsrfToken = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> => {
  const cookies = request.cookies ?? {};
  const cookieToken = (cookies as { [CSRF_TOKEN_COOKIE_NAME]?: string })[CSRF_TOKEN_COOKIE_NAME];
  const headerToken = request.headers[CSRF_TOKEN_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    return false;
  }

  if (cookieToken !== headerToken) {
    return false;
  }

  const userId = request.user?.id;
  const key = userId ? `csrf:${userId}:${cookieToken}` : `csrf:anonymous:${cookieToken}`;

  if (redisClient.isOpen) {
    try {
      const exists = await redisClient.get(key);
      if (exists !== "1") {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
};

export const requireCsrf = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const method = request.method;
  
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const url = request.url;
  if (url.startsWith("/auth/login") || url.startsWith("/auth/signup")) {
    return;
  }

  const cookies = request.cookies ?? {};
  const cookieToken = (cookies as { [CSRF_TOKEN_COOKIE_NAME]?: string })[CSRF_TOKEN_COOKIE_NAME];
  const headerToken = request.headers[CSRF_TOKEN_HEADER_NAME] as string | undefined;
  if (!headerToken) {
    return reply.code(403).send({ error: "missing_csrf_token" });
  }
  if (!cookieToken) {
    return reply.code(403).send({ error: "missing_csrf_token" });
  }
  const isValid = await validateCsrfToken(request, reply);
  if (!isValid) {
    return reply.code(403).send({ error: "invalid_csrf_token" });
  }
};
