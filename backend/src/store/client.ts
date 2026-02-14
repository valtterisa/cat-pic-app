import { MongoClient, type MongoClientOptions } from "mongodb";
import { loadEnv } from "../config/env";

let client: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (client) return client;
  const env = loadEnv();
  client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 10,
  } as MongoClientOptions);
  await client.connect();
  return client;
}

export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

const DB_NAME = "content";

export async function getContentDb() {
  const c = await getMongoClient();
  return c.db(DB_NAME);
}
