import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { existsSync } from "fs";
import type { QuoteDoc } from "../src/store/types";
import { insertQuotes } from "../src/store/content";
import { getMongoClient, closeMongoClient } from "../src/store/client";

const JSONL_NAME = "english_quotes/quotes.jsonl";

function findJsonlPath(): string {
  const fromBackend = join(process.cwd(), "..", JSONL_NAME);
  const fromRoot = join(process.cwd(), JSONL_NAME);
  if (existsSync(fromBackend)) return fromBackend;
  if (existsSync(fromRoot)) return fromRoot;
  throw new Error(`Could not find ${JSONL_NAME} from ${process.cwd()}. Tried: ${fromBackend}, ${fromRoot}`);
}

async function main() {
  const path = findJsonlPath();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const docs: QuoteDoc[] = [];
  const now = new Date();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as { quote?: string; author?: string };
      const text = typeof row.quote === "string" ? row.quote : "";
      if (!text) continue;
      docs.push({
        id: crypto.randomUUID(),
        author: typeof row.author === "string" && row.author.length > 0 ? row.author.trim() : null,
        text,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // skip invalid lines
    }
  }

  if (docs.length === 0) {
    console.log("No quotes to insert.");
    process.exit(0);
  }

  await getMongoClient();
  await insertQuotes(docs);
  console.log(`Inserted ${docs.length} quotes.`);
  await closeMongoClient();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
