import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import { db, dbRead } from "../../db/drizzle";
import { quotes, quoteLikes, savedQuotes } from "../../db/schema";
import { redisClient } from "../../redis/client";
import { requireAuth, optionalAuth } from "../../middleware/auth";
import { requireApiKey } from "../../middleware/api-key";
import { produceQuoteLikeEvent, produceQuoteSaveEvent } from "../../kafka/client";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

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
    .string()
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 100)
    .optional(),
  sort: z.enum(["newest", "popular"]).optional(),
  offset: z
    .string()
    .transform((v) => Number(v))
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

  fastify.get(
    "/quotes/random",
    {
      preHandler: [requireApiKey],
      schema: {
        tags: ["Quotes"],
        description: "Requires X-API-Key header",
        response: { 200: quoteSchema, 404: { type: "object", properties: { error: { type: "string" } } } },
      },
    },
    async (_request, reply) => {
      if (redisClient.isOpen) {
        try {
          const cached = await redisClient.get(RANDOM_QUOTE_CACHE_KEY);
          if (cached) {
            return reply.send(JSON.parse(cached) as unknown);
          }
        } catch {
          // ignore cache errors, fall through to DB
        }
      }

      const allRows = await dbRead.select().from(quotes);
      if (allRows.length === 0) {
        return reply.code(404).send({ error: "no_quotes" });
      }
      const randomIndex = Math.floor(Math.random() * allRows.length);
      const quote = allRows[randomIndex];

      if (redisClient.isOpen) {
        try {
          await redisClient.set(
            RANDOM_QUOTE_CACHE_KEY,
            JSON.stringify(quote),
            { EX: RANDOM_QUOTE_CACHE_TTL_SEC },
          );
        } catch {
          // ignore
        }
      }

      return reply.send(quote);
    },
  );

  const feedItemSchema = {
    ...quoteSchema,
    properties: {
      ...quoteSchema.properties,
      likeCount: { type: "number" },
      liked: { type: "boolean" },
      saved: { type: "boolean" },
    },
  };

  fastify.get("/feed", {
    preHandler: [optionalAuth],
    schema: {
      tags: ["Quotes"],
      description: "Public feed. Optional auth returns liked/saved. sort=newest (cursor) or popular (offset).",
      querystring: {
        type: "object",
        properties: {
          cursor: { type: "string", format: "uuid" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          sort: { type: "string", enum: ["newest", "popular"] },
          offset: { type: "integer", minimum: 0 },
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

    let rows: { id: string; author: string | null; text: string; createdBy: string | null; createdAt: Date; updatedAt: Date | null }[];
    let nextCursor: string | null = null;
    let nextOffset: number | null = null;

    if (sort === "popular") {
      const off = offset ?? 0;
      const subquery = dbRead
        .select({ quoteId: quoteLikes.quoteId, c: sql<number>`count(*)::int` })
        .from(quoteLikes)
        .groupBy(quoteLikes.quoteId)
        .as("likes");
      rows = await dbRead
        .select({
          id: quotes.id,
          author: quotes.author,
          text: quotes.text,
          createdBy: quotes.createdBy,
          createdAt: quotes.createdAt,
          updatedAt: quotes.updatedAt,
        })
        .from(quotes)
        .leftJoin(subquery, eq(quotes.id, subquery.quoteId))
        .orderBy(desc(sql`coalesce(${subquery.c}, 0)`), desc(quotes.createdAt), desc(quotes.id))
        .limit(pageSize + 1)
        .offset(off);
      const hasNext = rows.length > pageSize;
      const slice = hasNext ? rows.slice(0, pageSize) : rows;
      nextOffset = hasNext ? off + pageSize : null;
      rows = slice;
    } else {
      if (cursor) {
        rows = await dbRead
          .select()
          .from(quotes)
          .where(lt(quotes.id, cursor))
          .orderBy(desc(quotes.createdAt), desc(quotes.id))
          .limit(pageSize + 1);
      } else {
        rows = await dbRead
          .select()
          .from(quotes)
          .orderBy(desc(quotes.createdAt), desc(quotes.id))
          .limit(pageSize + 1);
      }
      const hasNext = rows.length > pageSize;
      const items = hasNext ? rows.slice(0, pageSize) : rows;
      nextCursor = hasNext ? items[items.length - 1]?.id ?? null : null;
      rows = items;
    }

    const quoteIds = rows.map((r) => r.id);
    const likeCounts: Record<string, number> = {};
    const likedSet = new Set<string>();
    const savedSet = new Set<string>();

    if (redisClient.isOpen) {
      try {
        const countKeys = quoteIds.map((id) => `${REDIS_LIKE_COUNT_PREFIX}${id}`);
        const countVals = await redisClient.mGet(countKeys);
        quoteIds.forEach((id, i) => {
          const v = countVals[i];
          likeCounts[id] = v != null ? parseInt(v, 10) : 0;
          if (Number.isNaN(likeCounts[id])) likeCounts[id] = 0;
        });
        if (userId) {
          for (const qid of quoteIds) {
            const member = await redisClient.sIsMember(`${REDIS_USER_LIKES_PREFIX}${userId}`, qid);
            if (member) likedSet.add(qid);
            const saved = await redisClient.sIsMember(`${REDIS_USER_SAVES_PREFIX}${userId}`, qid);
            if (saved) savedSet.add(qid);
          }
        }
      } catch {
        // fall through to DB
      }
    }

    if (!redisClient.isOpen && quoteIds.length > 0) {
      const likeCountRows = await dbRead
        .select({ quoteId: quoteLikes.quoteId, c: sql<number>`count(*)::int` })
        .from(quoteLikes)
        .where(quoteIds.length > 0 ? inArray(quoteLikes.quoteId, quoteIds) : sql`false`)
        .groupBy(quoteLikes.quoteId);
      for (const r of likeCountRows) {
        likeCounts[r.quoteId] = r.c;
      }
      if (userId) {
        const [likedRows, savedRows] = await Promise.all([
          dbRead.select({ quoteId: quoteLikes.quoteId }).from(quoteLikes).where(eq(quoteLikes.userId, userId)),
          dbRead.select({ quoteId: savedQuotes.quoteId }).from(savedQuotes).where(eq(savedQuotes.userId, userId)),
        ]);
        for (const r of likedRows) likedSet.add(r.quoteId);
        for (const r of savedRows) savedSet.add(r.quoteId);
      }
    }

    const items = rows.map((q) => ({
      ...q,
      likeCount: likeCounts[q.id] ?? 0,
      liked: userId ? likedSet.has(q.id) : undefined,
      saved: userId ? savedSet.has(q.id) : undefined,
    }));

    return reply.send({ items, nextCursor, nextOffset });
  });

  fastify.post("/feed/saved/:quoteId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Quotes"],
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
        await produceQuoteSaveEvent({ userId, quoteId: parsed.data, action: "save" });
        return reply.code(added ? 201 : 200).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await db.insert(savedQuotes).values({ userId, quoteId: parsed.data }).onConflictDoNothing();
    return reply.code(201).send();
  });

  fastify.delete("/feed/saved/:quoteId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Quotes"],
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
        await produceQuoteSaveEvent({ userId, quoteId: parsed.data, action: "unsave" });
        return reply.code(204).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await db.delete(savedQuotes).where(and(eq(savedQuotes.userId, userId), eq(savedQuotes.quoteId, parsed.data)));
    return reply.code(204).send();
  });

  fastify.post("/feed/likes/:quoteId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Quotes"],
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
        await produceQuoteLikeEvent({ userId, quoteId: parsed.data, action: "like" });
        return reply.code(201).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await db.insert(quoteLikes).values({ userId, quoteId: parsed.data }).onConflictDoNothing();
    return reply.code(201).send();
  });

  fastify.delete("/feed/likes/:quoteId", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Quotes"],
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
        await produceQuoteLikeEvent({ userId, quoteId: parsed.data, action: "unlike" });
        return reply.code(204).send();
      } catch (e) {
        if (!redisClient.isOpen) return reply.code(500).send({ error: "redis_unavailable" });
        throw e;
      }
    }
    await db.delete(quoteLikes).where(and(eq(quoteLikes.userId, userId), eq(quoteLikes.quoteId, parsed.data)));
    return reply.code(204).send();
  });

  fastify.get(
    "/quotes",
    {
      preHandler: [requireApiKey],
      schema: {
        tags: ["Quotes"],
        description: "List quotes with optional author filter. When author is set, responses are cached in Redis (5 min). On cache miss, data is read from the read-only Postgres replica.",
        querystring: {
          type: "object",
          properties: {
            author: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description: "Filter by author (case-insensitive). When provided, result is cached.",
            },
            cursor: {
              type: "string",
              format: "uuid",
              description: "Pagination cursor from previous response nextCursor.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
              description: "Page size (1–100). Sent as query string, e.g. limit=20.",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              items: { type: "array", items: quoteSchema },
              nextCursor: { type: ["string", "null"] },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query" });
      }
      const { author, cursor, limit } = parsed.data;
      const pageSize = limit ?? 20;

      if (author != null && redisClient.isOpen) {
        const cacheKey = `${BY_AUTHOR_CACHE_PREFIX}${encodeURIComponent(author)}:${cursor ?? ""}:${pageSize}`;
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            return reply.send(JSON.parse(cached) as { items: unknown[]; nextCursor: string | null });
          }
        } catch {
          // fall through to read replica
        }
      }

      const authorCondition = author != null ? sql`lower(${quotes.author}) = lower(${author})` : undefined;

      let rows;
      if (cursor) {
        rows = authorCondition
          ? await dbRead
              .select()
              .from(quotes)
              .where(and(authorCondition, lt(quotes.id, cursor)))
              .orderBy(desc(quotes.createdAt), desc(quotes.id))
              .limit(pageSize + 1)
          : await dbRead
              .select()
              .from(quotes)
              .where(lt(quotes.id, cursor))
              .orderBy(desc(quotes.createdAt), desc(quotes.id))
              .limit(pageSize + 1);
      } else {
        rows = authorCondition
          ? await dbRead
              .select()
              .from(quotes)
              .where(authorCondition)
              .orderBy(desc(quotes.createdAt), desc(quotes.id))
              .limit(pageSize + 1)
          : await dbRead
              .select()
              .from(quotes)
              .orderBy(desc(quotes.createdAt), desc(quotes.id))
              .limit(pageSize + 1);
      }

      const hasNext = rows.length > pageSize;
      const items = hasNext ? rows.slice(0, pageSize) : rows;
      const nextCursor = hasNext ? items[items.length - 1]?.id ?? null : null;
      const payload = { items, nextCursor };

      if (author != null && redisClient.isOpen) {
        const cacheKey = `${BY_AUTHOR_CACHE_PREFIX}${encodeURIComponent(author)}:${cursor ?? ""}:${pageSize}`;
        try {
          await redisClient.set(cacheKey, JSON.stringify(payload), {
            EX: BY_AUTHOR_CACHE_TTL_SEC,
          });
        } catch {
          // ignore
        }
      }

      if (author != null && items.length === 0) {
        return reply.code(404).send({ error: "no_quotes_for_author" });
      }

      return reply.send(payload);
    },
  );

  fastify.get(
    "/dashboard/quotes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Quotes"],
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

      const rows = await dbRead
        .select()
        .from(quotes)
        .where(eq(quotes.createdBy, request.user.id));

      return reply.send({ items: rows });
    },
  );

  fastify.post(
    "/dashboard/quotes",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Quotes"],
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

      const [created] = await db
        .insert(quotes)
        .values({
          text: parsed.data.text,
          author: parsed.data.author,
          createdBy: request.user.id,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  fastify.put(
    "/dashboard/quotes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Quotes"],
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

      const [updated] = await db
        .update(quotes)
        .set(parsed.data)
        .where(
          and(
            eq(quotes.id, idResult.data),
            eq(quotes.createdBy, request.user.id),
          ),
        )
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.send(updated);
    },
  );

  fastify.delete(
    "/dashboard/quotes/:id",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Quotes"],
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

      const [deleted] = await db
        .delete(quotes)
        .where(
          and(
            eq(quotes.id, idResult.data),
            eq(quotes.createdBy, request.user.id),
          ),
        )
        .returning();

      if (!deleted) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(204).send();
    },
  );
}
