import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import { db } from "../../db/drizzle";
import { apiKeys } from "../../db/schema";
import { requireAuth } from "../../middleware/auth";
import { generateApiKey } from "../../middleware/api-key";
import { and, eq } from "drizzle-orm";

const createSchema = z.object({
  label: z.string().min(1).max(255),
});

const uuidParamSchema = z.string().uuid();

export async function apiKeysRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
) {
  fastify.get("/", {
    preHandler: [requireAuth],
    schema: {
      tags: ["API Keys"],
      response: {
        200: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, createdAt: { type: "string" }, revokedAt: { type: ["string", "null"] } } },
            },
          },
        },
        401: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, request.user.id));

    return reply.send({
      keys: rows.map((k) => ({
        id: k.id,
        label: k.label,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      })),
    });
  });

  fastify.post("/", {
    preHandler: [requireAuth],
    schema: {
      tags: ["API Keys"],
      body: { type: "object", required: ["label"], properties: { label: { type: "string", minLength: 1 } } },
      response: {
        201: {
          type: "object",
          properties: {
            key: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, createdAt: { type: "string" } } },
            token: { type: "string" },
          },
        },
        400: { type: "object", properties: { error: { type: "string" } } },
        401: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const result = createSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const { label } = result.data;
    const { raw, hash } = generateApiKey();

    const [created] = await db
      .insert(apiKeys)
      .values({
        userId: request.user.id,
        keyHash: hash,
        label,
      })
      .returning();

    return reply.code(201).send({
      key: {
        id: created.id,
        label: created.label,
        createdAt: created.createdAt,
      },
      token: raw,
    });
  });

  fastify.post(
    "/:id/revoke",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["API Keys"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
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

      const updated = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, idResult.data), eq(apiKeys.userId, request.user.id)))
        .returning();

      if (updated.length === 0) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.send({ success: true });
    },
  );
}
