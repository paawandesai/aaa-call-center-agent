import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
let extractor: Promise<Extractor> | undefined;

// Local, permissive embeddings (bge-small-en-v1.5, MIT). Same model as the offline retrieval eval.
async function load(): Promise<Extractor> {
  const tf = await import("@huggingface/transformers");
  tf.env.cacheDir = process.env.MODEL_CACHE_DIR ?? path.join(process.cwd(), ".models");
  // One line at load so a missing local copy is visible in the deploy log (no request data in it).
  console.log(`embedding model ${config.embedModel}@${config.embedRevision.slice(0, 7)}, cache ${tf.env.cacheDir}, local copy ${existsSync(path.join(tf.env.cacheDir, config.embedModel)) ? "present" : "missing"}`);
  // The build downloads the pinned revision (scripts/warm_model.ts), so the server normally reads that local copy.
  return (await tf.pipeline("feature-extraction", config.embedModel, { dtype: "fp32", revision: config.embedRevision })) as unknown as Extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  // A failed load is forgotten, so the next request retries instead of failing until a restart.
  extractor ??= load().catch((e) => { extractor = undefined; throw e; });
  const ex = await extractor;
  const out = await ex(texts, { pooling: "cls", normalize: true });
  const dim = out.dims[1];
  return texts.map((_, i) => Array.from(out.data.slice(i * dim, (i + 1) * dim)));
}

// Loads the model at server start (instrumentation.ts), so the first caller doesn't wait and a failure shows in the log.
export const warmEmbeddings = () => embed(["warm up"]).then(() => undefined);

export const embedQuery = async (q: string) => (await embed([config.embedQueryPrefix + q]))[0];
export const toVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;
