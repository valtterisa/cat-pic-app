import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import { redisClient } from "../../redis/client";
import { requireAuth, optionalAuth } from "../../middleware/auth";
import { requireApiKey } from "../../middleware/api-key";
import { requireCsrf } from "../../middleware/csrf";
import * as content from "../../store/content";

const RANDOM_QUOTE_CACHE_KEY = "quotes:random";
const RANDOM_QUOTE_CACHE_TTL_SEC = 60;
const BY_AUTHOR_CACHE_TTL_SEC = 300;
const BY_AUTHOR_CACHE_PREFIX = "quotes:by_author:";
const REDIS_LIKE_COUNT_PREFIX = "like_count:";
const REDIS_USER_LIKES_PREFIX = "user_likes:";
const REDIS_USER_SAVES_PREFIX = "user_saves:";

const createQuoteSchema = z.object({
  text: z.string().min(1).max(10_000),
  author: z.string().max(500).optional(),
});

const updateQuoteSchema = createQuoteSchema.partial();

const uuidParamSchema = z.string().uuid();

const listQuerySchema = z.object({
  author: z.string().min(1).max(500).transform((s) => s.trim()).optional(),
  cursor: z.string().uuid().optional(),
  limit: z
    .string()
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 100)
    .optional(),
});

const feedQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 100)
    .optional(),
  sort: z.enum(["newest", "popular"]).optional(),
  offset: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .refine((n) => Number.isInteger(n) && n >= 0)
    .optional(),
});

export async function quotesRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
) {
  const quoteSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      text: { type: "string" },
      author: { type: ["string", "null"] },
      createdBy: { type: ["string", "null"] },
      createdAt: { type: "string" },
      updatedAt: { type: ["string", "null"] },
    },
  };

  const feedItemSchema = {
    ...quoteSchema,
    properties: {
      ...quoteSchema.properties,
      likeCount: { type: "number" },
      liked: { type: "boolean" },
      saved: { type: "boolean" },
    },
  };

  fastify.get("/quotes/random", {
    preHandler: [requireApiKey],
    schema: {
      tags: ["Public"],
      description: "Random quote. X-API-Key required. For use in your own app/site.",
      response: { 200: quoteSchema, 404: { type: "object", properties: { error: { type: "string" } } } },
    },
  }, async (_request, reply) => {
    if (redisClient.isOpen) {
      try {
        const cached = await redisClient.get(RANDOM_QUOTE_CACHE_KEY);
        if (cached) return reply.send(JSON.parse(cached) as unknown);
      } catch {
        // ignore
      }
    }
    const quote = await content.getRandomQuote();
    if (!quote) return reply.code(404).send({ error: "no_quotes" });
    if (redisClient.isOpen) {
      try {
        await redisClient.set(RANDOM_QUOTE_CACHE_KEY, JSON.stringify(quote), { EX: RANDOM_QUOTE_CACHE_TTL_SEC });
      } catch {
        // ignore
      }
    }
    return reply.send(quote);
  });

  fastify.get("/quotes", {
    preHandler: [requireApiKey],
    schema: {
      tags: ["Public"],
      description: "List quotes (author/cursor/limit). X-API-Key required. For use in your own app/site.",
      querystring: {
        type: "object",
        properties: {
          author: { type: "string", minLength: 1, maxLength: 500 },
          cursor: { type: "string", format: "uuid" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { type: "object", properties: { items: { type: "array", items: quoteSchema }, nextCursor: { type: ["string", "null"] } } },
        400: { type: "object", properties: { error: { type: "string" } } },
        404: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const { author, cursor, limit } = parsed.data;
    const pageSize = limit ?? 20;
    if (author != null && redisClient.isOpen) {
      try {
        const cacheKey = `${BY_AUTHOR_CACHE_PREFIX}${encodeURIComponent(author)}:${cursor ?? ""}:${pageSize}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) return reply.send(JSON.parse(cached) as { items: unknown[]; nextCursor: string | null });
      } catch {
        // fall through
      }
    }
    const { items, nextCursor } = await content.listQuotes({ author: author ?? undefined, cursor: cursor ?? undefined, limit: pageSize });
    const payload = { items, nextCursor };
    if (author != null && redisClient.isOpen) {
      try {
        const cacheKey = `${BY_AUTHOR_CACHE_PREFIX}${encodeURIComponent(author)}:${cursor ?? ""}:${pageSize}`;
        await redisClient.set(cacheKey, JSON.stringify(payload), { EX: BY_AUTHOR_CACHE_TTL_SEC });
      } catch {
        // ignore
      }
    }
    if (author != null && items.length === 0) return reply.code(404).send({ error: "no_quotes_for_author" });
    return reply.send(payload);
  });

  fastify.get("/feed", {
    preHandler: [optionalAuth],
    schema: {
      tags: ["Feed"],
      description: "Public feed. Optional auth returns liked/saved. sort=newest (cursor) or popular (offset).",
      querystring: {
        type: "object",
        properties: {
          cursor: { type: "string", format: "uuid" },
          limit: { type: "string" },
          sort: { type: "string", enum: ["newest", "popular"] },
          offset: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            items: { type: "array", items: feedItemSchema },
            nextCursor: { type: ["string", "null"] },
            nextOffset: { type: ["number", "null"] },
          },
        },
        400: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }
    const { cursor, limit, sort: sortParam, offset } = parsed.data;
    const pageSize = limit ?? 20;
    const sort = sortParam ?? "newest";
    const userId = request.user?.id;

    let rows: Awaited<ReturnType<typeof content.getFeedNewest>>["items"];
    let nextCursor: string | null = null;
    let nextOffset: number | null = null;

    if (sort === "popular") {
      const off = offset ?? 0;
      const result = await content.getFeedPopular({ offset: off, limit: pageSize });
      rows = result.items;
      nextOffset = result.nextOffset;
    } else {
      const result = await content.getFeedNewest({ cursor: cursor ?? undefined, limit: pageSize });
      rows = result.items;
      nextCursor = result.nextCursor;
    }

    const quoteIds = rows.map((r) => r.id);
    const [likeCounts, likedSet, savedSet] = await Promise.all([
      content.getLikeCounts(quoteIds),
      userId ? content.hasLiked(userId, quoteIds) : Promise.resolve(new Set<string>()),
      userId ? content.hasSaved(userId, quoteIds) : Promise.resolve(new Set<string>()),
    ]);

    const items = rows.map((q) => ({
      ...q,
      likeCount: likeCounts[q.id] ?? 0,
      liked: userId ? likedSet.has(q.id) : undefined,
      saved: userId ? savedSet.has(q.id) : undefined,
    }));

    return reply.send({ items, nextCursor, nextOffset });
  });

  fastify.post("/feed/saved/:quoteId", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Feed"],
      params: { type: "object", required: ["quoteId"], properties: { quoteId: { type: "string", format: "uuid" } } },
      response: {
        201: { type: "null" },
        200: { type: "null" },
        400: { type: "object", properties: { error: { type: "string" } } },
        401: { type: "object", properties: { error: { type: "string" } } },
        500: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const raw = (request.params as { quoteId?: string }).quoteId;
    const quoteId = typeof raw === "string" ? raw : raw?.[0];
    const parsed = uuidParamSchema.safeParse(quoteId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = request.user.id;
    const key = `${REDIS_USER_SAVES_PREFIX}${userId}`;
    if (redisClient.isOpen) {
      try {
        const added = await redisClient.sAdd(key, parsed.data);
        await content.addSave(userId, parsed.data);
        return reply.code(added ? 201 : 200).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await content.addSave(userId, parsed.data);
    return reply.code(201).send();
  });

  fastify.delete("/feed/saved/:quoteId", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Feed"],
      params: { type: "object", required: ["quoteId"], properties: { quoteId: { type: "string", format: "uuid" } } },
      response: {
        204: { type: "null" },
        400: { type: "object", properties: { error: { type: "string" } } },
        401: { type: "object", properties: { error: { type: "string" } } },
        500: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const raw = (request.params as { quoteId?: string }).quoteId;
    const quoteId = typeof raw === "string" ? raw : raw?.[0];
    const parsed = uuidParamSchema.safeParse(quoteId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = request.user.id;
    if (redisClient.isOpen) {
      try {
        await redisClient.sRem(`${REDIS_USER_SAVES_PREFIX}${userId}`, parsed.data);
        await content.removeSave(userId, parsed.data);
        return reply.code(204).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await content.removeSave(userId, parsed.data);
    return reply.code(204).send();
  });

  fastify.post("/feed/likes/:quoteId", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Feed"],
      params: { type: "object", required: ["quoteId"], properties: { quoteId: { type: "string", format: "uuid" } } },
      response: {
        201: { type: "null" },
        200: { type: "null" },
        400: { type: "object", properties: { error: { type: "string" } } },
        401: { type: "object", properties: { error: { type: "string" } } },
        500: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const raw = (request.params as { quoteId?: string }).quoteId;
    const quoteId = typeof raw === "string" ? raw : raw?.[0];
    const parsed = uuidParamSchema.safeParse(quoteId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = request.user.id;
    const likesKey = `${REDIS_USER_LIKES_PREFIX}${userId}`;
    const countKey = `${REDIS_LIKE_COUNT_PREFIX}${parsed.data}`;
    if (redisClient.isOpen) {
      try {
        const already = await redisClient.sIsMember(likesKey, parsed.data);
        if (already) return reply.code(200).send();
        await redisClient.sAdd(likesKey, parsed.data);
        await redisClient.incr(countKey);
        await content.addLike(userId, parsed.data);
        return reply.code(201).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await content.addLike(userId, parsed.data);
    return reply.code(201).send();
  });

  fastify.delete("/feed/likes/:quoteId", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Feed"],
      params: { type: "object", required: ["quoteId"], properties: { quoteId: { type: "string", format: "uuid" } } },
      response: {
        204: { type: "null" },
        400: { type: "object", properties: { error: { type: "string" } } },
        401: { type: "object", properties: { error: { type: "string" } } },
        500: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const raw = (request.params as { quoteId?: string }).quoteId;
    const quoteId = typeof raw === "string" ? raw : raw?.[0];
    const parsed = uuidParamSchema.safeParse(quoteId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = request.user.id;
    if (redisClient.isOpen) {
      try {
        await redisClient.sRem(`${REDIS_USER_LIKES_PREFIX}${userId}`, parsed.data);
        const countKey = `${REDIS_LIKE_COUNT_PREFIX}${parsed.data}`;
        const v = await redisClient.get(countKey);
        if (v) {
          const n = parseInt(v, 10);
          if (n > 0) await redisClient.decr(countKey);
        }
        await content.removeLike(userId, parsed.data);
        return reply.code(204).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await content.removeLike(userId, parsed.data);
    return reply.code(204).send();
  });

  fastify.get(
    "/dashboard/quotes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Dashboard"],
        response: {
          200: { type: "object", properties: { items: { type: "array", items: quoteSchema } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const rows = await content.getDashboardQuotes(request.user.id);
      return reply.send({ items: rows });
    },
  );

  fastify.get(
    "/dashboard/liked",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Dashboard"],
        response: {
          200: { type: "object", properties: { items: { type: "array", items: feedItemSchema } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const userId = request.user.id;
      const likedQuoteIds = await content.getLikedQuoteIds(userId);
      if (likedQuoteIds.length === 0) {
        return reply.send({ items: [] });
      }
      const rows = await content.getQuotesByIds(likedQuoteIds);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const quoteIds = rows.map((r) => r.id);
      const [likeCounts, savedSet] = await Promise.all([
        content.getLikeCounts(quoteIds),
        content.hasSaved(userId, quoteIds),
      ]);
      const items = rows.map((q) => ({
        ...q,
        likeCount: likeCounts[q.id] ?? 0,
        liked: true,
        saved: savedSet.has(q.id),
      }));
      return reply.send({ items });
    },
  );

  fastify.get(
    "/dashboard/saved",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Dashboard"],
        response: {
          200: { type: "object", properties: { items: { type: "array", items: feedItemSchema } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const userId = request.user.id;
      const savedQuoteIds = await content.getSavedQuoteIds(userId);
      if (savedQuoteIds.length === 0) {
        return reply.send({ items: [] });
      }
      const rows = await content.getQuotesByIds(savedQuoteIds);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const quoteIds = rows.map((r) => r.id);
      const [likeCounts, likedSet] = await Promise.all([
        content.getLikeCounts(quoteIds),
        content.hasLiked(userId, quoteIds),
      ]);
      const items = rows.map((q) => ({
        ...q,
        likeCount: likeCounts[q.id] ?? 0,
        liked: likedSet.has(q.id),
        saved: true,
      }));
      return reply.send({ items });
    },
  );

  fastify.post(
    "/dashboard/quotes",
    {
      preHandler: [requireAuth, requireCsrf],
      schema: {
        tags: ["Dashboard"],
        body: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string", minLength: 1 }, author: { type: "string" } },
        },
        response: {
          201: quoteSchema,
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const parsed = createQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const created = await content.createQuote({
        text: parsed.data.text,
        author: parsed.data.author ?? undefined,
        createdBy: request.user.id,
      });
      return reply.code(201).send(created);
    },
  );

  fastify.put(
    "/dashboard/quotes/:id",
    {
      preHandler: [requireAuth, requireCsrf],
      schema: {
        tags: ["Dashboard"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: { type: "object", properties: { text: { type: "string", minLength: 1 }, author: { type: "string" } } },
        response: {
          200: quoteSchema,
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const rawId = (request.params as { id?: string }).id;
      const id = typeof rawId === "string" ? rawId : rawId?.[0];
      const idResult = uuidParamSchema.safeParse(id);
      if (!idResult.success) {
        return reply.code(400).send({ error: "invalid_id" });
      }
      const parsed = updateQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const existing = await content.getQuoteById(idResult.data);
      if (!existing || existing.createdBy !== request.user.id) {
        return reply.code(404).send({ error: "not_found" });
      }

      const updated = await content.updateQuote(idResult.data, {
        text: parsed.data.text,
        author: parsed.data.author,
      });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return reply.send(updated);
    },
  );

  fastify.delete(
    "/dashboard/quotes/:id",
    {
      preHandler: [requireAuth, requireCsrf],
      schema: {
        tags: ["Dashboard"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: {
          204: { type: "null" },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const rawId = (request.params as { id?: string }).id;
      const id = typeof rawId === "string" ? rawId : rawId?.[0];
      const idResult = uuidParamSchema.safeParse(id);
      if (!idResult.success) {
        return reply.code(400).send({ error: "invalid_id" });
      }

      const existing = await content.getQuoteById(idResult.data);
      if (!existing || existing.createdBy !== request.user.id) {
        return reply.code(404).send({ error: "not_found" });
      }

      await content.deleteQuote(idResult.data);
      return reply.code(204).send();
    },
  );
}
