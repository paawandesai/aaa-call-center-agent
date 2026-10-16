import Anthropic from "@anthropic-ai/sdk";
import type { Deps } from "./agent";
import { db } from "./db";
import { searchKb } from "./retrieval";

let client: Anthropic | undefined;
export function defaultDeps(): Deps {
  // The key is read server-side only, from ANTHROPIC_AEA_API_KEY. It never reaches the client bundle.
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_AEA_API_KEY, maxRetries: 2, timeout: 60_000 });
  return { db: db(), anthropic: client, search: (q) => searchKb(db(), q) };
}
