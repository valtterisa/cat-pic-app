import { Kafka, Partitioners, type Producer } from "kafkajs";
import { loadEnv } from "../config/env";

const env = loadEnv();

let producer: Producer | null = null;

async function getProducer(): Promise<Producer | null> {
  if (!env.KAFKA_BROKERS) return null;
  if (producer) return producer;
  const kafka = new Kafka({
    clientId: "motivational-quotes-api",
    brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()),
  });
  producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  await producer.connect();
  return producer;
}

export async function produceQuoteLikeEvent(payload: {
  userId: string;
  quoteId: string;
  action: "like" | "unlike";
}): Promise<void> {
  const p = await getProducer();
  if (!p) return;
  const key = `${payload.userId}:${payload.quoteId}`;
  await p.send({
    topic: "quote-likes",
    messages: [
      {
        key,
        value: JSON.stringify({
          user_id: payload.userId,
          quote_id: payload.quoteId,
          action: payload.action,
          ts: new Date().toISOString(),
        }),
      },
    ],
  });
}

export async function produceQuoteSaveEvent(payload: {
  userId: string;
  quoteId: string;
  action: "save" | "unsave";
}): Promise<void> {
  const p = await getProducer();
  if (!p) return;
  const key = `${payload.userId}:${payload.quoteId}`;
  await p.send({
    topic: "quote-saves",
    messages: [
      {
        key,
        value: JSON.stringify({
          user_id: payload.userId,
          quote_id: payload.quoteId,
          action: payload.action,
          ts: new Date().toISOString(),
        }),
      },
    ],
  });
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
