import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";

export async function migrate(d: Db, dir = path.join(process.cwd(), "db", "migrations")) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await d.exec(readFileSync(path.join(dir, f), "utf8"));
  }
}
