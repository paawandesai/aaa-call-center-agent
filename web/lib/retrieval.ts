import type { Queryable } from "./db";
import { config } from "./config";
import { embedQuery, toVector } from "./embed";

export interface Passage {
  id: string;
  doc: string;
  doc_title: string;
  section: string;
  effective: string | null;
  text: string;
  score: number;
}

export async function searchKb(q: Queryable, query: string, k = config.retrievalK): Promise<Passage[]> {
  const v = toVector(await embedQuery(query));
  const { rows } = await q.query<Passage>(
    `SELECT id, doc, doc_title, section, effective, text,
            1 - (embedding <=> $1::vector) AS score
     FROM kb_chunks WHERE embed_model = $2 ORDER BY embedding <=> $1::vector LIMIT $3`,
    [v, config.embedTag, k],
  );
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}
