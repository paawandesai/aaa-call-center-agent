import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Db, Queryable } from "../lib/db";

// In-process Postgres for tests. Same SQL as production; no network.
export async function pgliteDb(): Promise<Db> {
  const pg = await PGlite.create({ extensions: { vector, btree_gist } });
  const wrap = (x: { query: PGlite["query"] }): Queryable => ({
    query: (sql, params) => x.query(sql, params as unknown[]) as never,
  });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
}
