import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import { db, dbRead } from "../../db/drizzle";
import { quotes } from "../../db/schema";
import { redisClient } from "../../redis/client";
import { requireAuth } from "../../middleware/auth";
import { requireApiKey } from "../../middleware/api-key";
import { and, desc, eq, lt, sql } from "drizzle-orm";

const RANDOM_QUOTE_CACHE_KEY = "quotes:random";
const RANDOM_QUOTE_CACHE_TTL_SEC = 60;
const BY_AUTHOR_CACHE_TTL_SEC = 300;
const BY_AUTHOR_CACHE_PREFIX = "quotes:by_author:";

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

  fastify.get("/feed", {
    schema: {
      tags: ["Quotes"],
      description: "Public feed; no API key required. Intentionally unauthenticated.",
      querystring: {
        type: "object",
        properties: { cursor: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
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
      },
    },
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }
    const { cursor, limit } = parsed.data;
    const pageSize = limit ?? 20;

    let rows;
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
    const nextCursor = hasNext ? items[items.length - 1]?.id ?? null : null;

    return reply.send({ items, nextCursor });
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
