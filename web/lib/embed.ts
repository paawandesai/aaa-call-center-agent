import path from "node:path";
import { config } from "./config";

type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
let extractor: Promise<Extractor> | undefined;

// Local, permissive embeddings (bge-small-en-v1.5, MIT). Same model as the offline retrieval eval.
async function load(): Promise<Extractor> {
  const tf = await import("@huggingface/transformers");
  tf.env.cacheDir = process.env.MODEL_CACHE_DIR ?? path.join(process.cwd(), ".models");
  return (await tf.pipeline("feature-extraction", config.embedModel, { dtype: "fp32" })) as unknown as Extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  extractor ??= load();
  const ex = await extractor;
  const out = await ex(texts, { pooling: "cls", normalize: true });
  const dim = out.dims[1];
  return texts.map((_, i) => Array.from(out.data.slice(i * dim, (i + 1) * dim)));
}

export const embedQuery = async (q: string) => (await embed([config.embedQueryPrefix + q]))[0];
export const toVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;
