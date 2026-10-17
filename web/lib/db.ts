import pg from "pg";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>; // multi-statement scripts (migrations)
  close(): Promise<void>;
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    // The deployed app reaches Postgres over Railway's private network (no TLS needed). Any other URL is encrypted but
    // the certificate isn't verified (Railway's public proxy uses one Node can't check), so use that path for local runs only.
    ssl: /sslmode=disable|\.railway\.internal/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (s, p) => client.query(s, p as unknown[]) as never });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

let shared: Db | undefined;
export function db(): Db {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Local e2e only: an in-process Postgres seeded on first use (see scripts/dev_pglite.ts).
    shared = url === "pglite:memory" ? lazyDevDb() : pgDb(url);
  }
  return shared;
}

function lazyDevDb(): Db {
  // One instance per process, even if Next bundles this module into several route graphs.
  const g = globalThis as { __devDb?: Promise<Db> };
  const get = () => (g.__devDb ??= import("../scripts/dev_pglite").then((m) => m.devDb()));
  return {
    query: async (s, a) => (await get()).query(s, a),
    tx: async (fn) => (await get()).tx(fn),
    exec: async (s) => (await get()).exec(s),
    close: async () => (await get()).close(),
  };
}

// Tests inject an in-process database (PGlite) here.
export function setDb(d: Db | undefined) {
  shared = d;
}
