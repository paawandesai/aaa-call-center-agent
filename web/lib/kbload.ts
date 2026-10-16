import { readFileSync } from "node:fs";
import type { Db } from "./db";
import { config } from "./config";
import { embed, toVector } from "./embed";

interface Chunk { id: string; doc: string; kind: string; effective: string | null; text: string }

// Loads curated chunks (output of kb/ingest.py) and stores the embedding model id with every vector.
export async function loadKb(d: Db, chunksPath: string) {
  const chunks = JSON.parse(readFileSync(chunksPath, "utf8")) as Chunk[];
  const vecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += 16) vecs.push(...(await embed(chunks.slice(i, i + 16).map((c) => c.text))));
  await d.tx(async (q) => {
    await q.query(`DELETE FROM kb_chunks`);
    for (const [i, c] of chunks.entries()) {
      // Chunk text starts with "Title > Section" (prose) or "Title | row" (table rows).
      const head = c.text.split("\n")[0].split(" | ")[0];
      const [title, ...rest] = head.split(" > ");
      await q.query(
        `INSERT INTO kb_chunks (id, doc, doc_title, section, effective, kind, text, embed_model, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)`,
        [c.id, c.doc, title.trim().slice(0, 120), (rest.join(" > ") || (c.kind === "text" ? "" : "Table")).trim().slice(0, 160), c.effective, c.kind, c.text,
         config.embedModel, toVector(vecs[i])],
      );
    }
  });
  return chunks.length;
}
