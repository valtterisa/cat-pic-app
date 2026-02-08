import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";

export const errorHandler = (
  err: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  if (process.env.NODE_ENV !== "production") {
    console.error("Error:", err);
  } else {
    console.error("Error:", err?.message ?? "internal_server_error");
  }
  reply.code(500).send({ error: "internal_server_error" });
};
