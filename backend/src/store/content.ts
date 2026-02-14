import { getContentDb } from "./client";
import type { QuoteDoc } from "./types";

const QUOTES = "quotes";
const QUOTE_LIKES = "quote_likes";
const SAVED_QUOTES = "saved_quotes";

function toQuoteDoc(raw: Record<string, unknown>): QuoteDoc {
  return {
    id: String(raw.id),
    author: raw.author != null ? String(raw.author) : null,
    text: String(raw.text),
    createdBy: raw.createdBy != null ? String(raw.createdBy) : null,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt)),
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : raw.updatedAt != null ? new Date(String(raw.updatedAt)) : null,
  };
}

export async function listQuotes(opts: { author?: string; cursor?: string; limit: number }): Promise<{ items: QuoteDoc[]; nextCursor: string | null }> {
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const filter: Record<string, unknown> = {};
  if (opts.author) {
    filter.author = { $regex: new RegExp(`^${opts.author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
  }
  if (opts.cursor) {
    const cursorFilter: Record<string, unknown> = { id: opts.cursor };
    if (filter.author) cursorFilter.author = filter.author;
    const cursorDoc = await coll.findOne(cursorFilter);
    if (cursorDoc && cursorDoc.createdAt) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, id: { $lt: opts.cursor } },
      ];
    } else {
      filter.id = { $lt: opts.cursor };
    }
  }
  const cursor = coll
    .find(filter)
    .sort({ createdAt: -1, id: -1 })
    .limit(opts.limit + 1);
  const rows = await cursor.toArray();
  const hasNext = rows.length > opts.limit;
  const items = (hasNext ? rows.slice(0, opts.limit) : rows).map((r) => toQuoteDoc(r as Record<string, unknown>));
  const nextCursor = hasNext && items.length > 0 ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

export async function getRandomQuote(): Promise<QuoteDoc | null> {
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const pipeline = [{ $sample: { size: 1 } }];
  const rows = await coll.aggregate(pipeline).toArray();
  if (rows.length === 0) return null;
  return toQuoteDoc(rows[0] as Record<string, unknown>);
}

export async function getQuoteById(id: string): Promise<QuoteDoc | null> {
  const db = await getContentDb();
  const doc = await db.collection(QUOTES).findOne({ id });
  if (!doc) return null;
  return toQuoteDoc(doc as Record<string, unknown>);
}

export async function getQuotesByIds(ids: string[]): Promise<QuoteDoc[]> {
  if (ids.length === 0) return [];
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const rows = await coll.find({ id: { $in: ids } }).toArray();
  const byId = new Map(rows.map((r) => [String((r as Record<string, unknown>).id), r as Record<string, unknown>]));
  return ids.filter((id) => byId.has(id)).map((id) => toQuoteDoc(byId.get(id)!));
}

export async function getFeedNewest(opts: { cursor?: string; limit: number }): Promise<{ items: QuoteDoc[]; nextCursor: string | null }> {
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const filter: Record<string, unknown> = {};
  if (opts.cursor) {
    const cursorDoc = await coll.findOne({ id: opts.cursor });
    if (cursorDoc && cursorDoc.createdAt) {
      filter.$or = [
        { createdAt: { $lt: cursorDoc.createdAt } },
        { createdAt: cursorDoc.createdAt, id: { $lt: opts.cursor } },
      ];
    } else {
      filter.id = { $lt: opts.cursor };
    }
  }
  const rows = await coll.find(filter).sort({ createdAt: -1, id: -1 }).limit(opts.limit + 1).toArray();
  const hasNext = rows.length > opts.limit;
  const items = (hasNext ? rows.slice(0, opts.limit) : rows).map((r) => toQuoteDoc(r as Record<string, unknown>));
  const nextCursor = hasNext && items.length > 0 ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

export async function getFeedPopular(opts: { offset: number; limit: number }): Promise<{ items: QuoteDoc[]; nextOffset: number | null }> {
  const db = await getContentDb();
  const likesColl = db.collection(QUOTE_LIKES);
  const quotesColl = db.collection(QUOTES);
  const agg = await likesColl
    .aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$quoteId", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: -1 } },
      { $skip: opts.offset },
      { $limit: opts.limit + 1 },
    ])
    .toArray();
  const hasNext = agg.length > opts.limit;
  const quoteIds = (hasNext ? agg.slice(0, opts.limit) : agg).map((r) => r._id);
  if (quoteIds.length === 0) {
    const fallback = await quotesColl.find({}).sort({ createdAt: -1, id: -1 }).limit(opts.limit + 1).skip(opts.offset).toArray();
    const hasMore = fallback.length > opts.limit;
    const items = (hasMore ? fallback.slice(0, opts.limit) : fallback).map((r) => toQuoteDoc(r as Record<string, unknown>));
    return { items, nextOffset: hasMore ? opts.offset + opts.limit : null };
  }
  const quotes = await getQuotesByIds(quoteIds);
  const orderMap = new Map(quoteIds.map((id, i) => [id, i]));
  quotes.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  return { items: quotes, nextOffset: hasNext ? opts.offset + opts.limit : null };
}

export async function createQuote(data: { text: string; author?: string | null; createdBy: string }): Promise<QuoteDoc> {
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const id = crypto.randomUUID();
  const now = new Date();
  const doc = {
    id,
    author: data.author ?? null,
    text: data.text,
    createdBy: data.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await coll.insertOne(doc);
  return toQuoteDoc(doc);
}

export async function updateQuote(quoteId: string, data: { text?: string; author?: string | null }): Promise<QuoteDoc | null> {
  const db = await getContentDb();
  const coll = db.collection(QUOTES);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.text !== undefined) update.text = data.text;
  if (data.author !== undefined) update.author = data.author;
  const result = await coll.findOneAndUpdate({ id: quoteId }, { $set: update }, { returnDocument: "after" });
  if (!result) return null;
  return toQuoteDoc(result as Record<string, unknown>);
}

export async function deleteQuote(quoteId: string): Promise<boolean> {
  const db = await getContentDb();
  const quotesColl = db.collection(QUOTES);
  const result = await quotesColl.deleteOne({ id: quoteId });
  await db.collection(QUOTE_LIKES).deleteMany({ quoteId });
  await db.collection(SAVED_QUOTES).deleteMany({ quoteId });
  return result.deletedCount === 1;
}

export async function addLike(userId: string, quoteId: string): Promise<void> {
  const db = await getContentDb();
  await db.collection(QUOTE_LIKES).updateOne(
    { userId, quoteId },
    { $setOnInsert: { userId, quoteId, createdAt: new Date() } },
    { upsert: true }
  );
}

export async function removeLike(userId: string, quoteId: string): Promise<void> {
  const db = await getContentDb();
  await db.collection(QUOTE_LIKES).deleteOne({ userId, quoteId });
}

export async function addSave(userId: string, quoteId: string): Promise<void> {
  const db = await getContentDb();
  await db.collection(SAVED_QUOTES).updateOne(
    { userId, quoteId },
    { $setOnInsert: { userId, quoteId, createdAt: new Date() } },
    { upsert: true }
  );
}

export async function removeSave(userId: string, quoteId: string): Promise<void> {
  const db = await getContentDb();
  await db.collection(SAVED_QUOTES).deleteOne({ userId, quoteId });
}

export async function getLikeCounts(quoteIds: string[]): Promise<Record<string, number>> {
  if (quoteIds.length === 0) return {};
  const db = await getContentDb();
  const rows = await db
    .collection(QUOTE_LIKES)
    .aggregate<{ _id: string; count: number }>([{ $match: { quoteId: { $in: quoteIds } } }, { $group: { _id: "$quoteId", count: { $sum: 1 } } }])
    .toArray();
  const out: Record<string, number> = {};
  for (const id of quoteIds) out[id] = 0;
  for (const r of rows) out[r._id] = r.count;
  return out;
}

export async function getLikedQuoteIds(userId: string): Promise<string[]> {
  const db = await getContentDb();
  const rows = await db.collection(QUOTE_LIKES).find({ userId }).project({ quoteId: 1 }).toArray();
  return rows.map((r) => String((r as Record<string, unknown>).quoteId));
}

export async function getSavedQuoteIds(userId: string): Promise<string[]> {
  const db = await getContentDb();
  const rows = await db.collection(SAVED_QUOTES).find({ userId }).project({ quoteId: 1 }).toArray();
  return rows.map((r) => String((r as Record<string, unknown>).quoteId));
}

export async function getDashboardQuotes(createdBy: string): Promise<QuoteDoc[]> {
  const db = await getContentDb();
  const rows = await db.collection(QUOTES).find({ createdBy }).sort({ createdAt: -1, id: -1 }).toArray();
  return rows.map((r) => toQuoteDoc(r as Record<string, unknown>));
}

export async function hasLiked(userId: string, quoteIds: string[]): Promise<Set<string>> {
  if (quoteIds.length === 0) return new Set();
  const db = await getContentDb();
  const rows = await db.collection(QUOTE_LIKES).find({ userId, quoteId: { $in: quoteIds } }).project({ quoteId: 1 }).toArray();
  return new Set(rows.map((r) => String((r as Record<string, unknown>).quoteId)));
}

export async function hasSaved(userId: string, quoteIds: string[]): Promise<Set<string>> {
  if (quoteIds.length === 0) return new Set();
  const db = await getContentDb();
  const rows = await db.collection(SAVED_QUOTES).find({ userId, quoteId: { $in: quoteIds } }).project({ quoteId: 1 }).toArray();
  return new Set(rows.map((r) => String((r as Record<string, unknown>).quoteId)));
}

export async function insertQuotes(docs: QuoteDoc[]): Promise<void> {
  if (docs.length === 0) return;
  const db = await getContentDb();
  await db.collection(QUOTES).insertMany(docs.map((d) => ({ ...d, createdAt: d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt), updatedAt: d.updatedAt instanceof Date ? d.updatedAt : d.updatedAt ? new Date(d.updatedAt) : null })));
}
