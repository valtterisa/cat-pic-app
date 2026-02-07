import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { pool } from "./drizzle";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export async function runMigrations(): Promise<void> {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of sqlFiles) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = await readFile(path, "utf-8");
    await pool.query(sql);
  }
}
