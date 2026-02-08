import { Kafka } from "kafkajs";
import { db } from "../db/drizzle";
import { quoteLikes, savedQuotes } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "../config/env";

const env = loadEnv();

async function run(): Promise<void> {
  if (!env.KAFKA_BROKERS) {
    console.warn("KAFKA_BROKERS not set; feed-events-consumer exiting");
    process.exit(0);
  }

  const kafka = new Kafka({
    clientId: "feed-events-consumer",
    brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()),
  });

  const consumer = kafka.consumer({ groupId: "feed-events-consumer" });
  await consumer.connect();
  await consumer.subscribe({ topics: ["quote-likes", "quote-saves"], fromBeginning: false });

  await consumer.run({
    eachBatch: async ({ batch, commitOffsetsIfNeeded }) => {
      const likesMap = new Map<string, "like" | "unlike">();
      const savesMap = new Map<string, "save" | "unsave">();

      for (const message of batch.messages) {
        const key = message.key?.toString();
        const value = message.value?.toString();
        if (!key || !value) continue;
        try {
          const payload = JSON.parse(value) as { user_id?: string; quote_id?: string; action?: string };
          const action = payload.action;
          if (batch.topic === "quote-likes" && (action === "like" || action === "unlike")) {
            likesMap.set(key, action);
          } else if (batch.topic === "quote-saves" && (action === "save" || action === "unsave")) {
            savesMap.set(key, action);
          }
        } catch {
          // skip invalid message
        }
      }

      try {
        if (batch.topic === "quote-likes") {
          for (const [key, action] of likesMap) {
            const [userId, quoteId] = key.split(":");
            if (action === "like") {
              await db.insert(quoteLikes).values({ userId, quoteId }).onConflictDoNothing();
            } else {
              await db.delete(quoteLikes).where(and(eq(quoteLikes.userId, userId), eq(quoteLikes.quoteId, quoteId)));
            }
          }
        } else if (batch.topic === "quote-saves") {
          for (const [key, action] of savesMap) {
            const [userId, quoteId] = key.split(":");
            if (action === "save") {
              await db.insert(savedQuotes).values({ userId, quoteId }).onConflictDoNothing();
            } else {
              await db.delete(savedQuotes).where(and(eq(savedQuotes.userId, userId), eq(savedQuotes.quoteId, quoteId)));
            }
          }
        }
        await commitOffsetsIfNeeded();
      } catch (err) {
        console.error("Feed consumer batch error", err);
      }
    },
  });
}

run().catch((err) => {
  console.error("Feed consumer failed", err);
  process.exit(1);
});
