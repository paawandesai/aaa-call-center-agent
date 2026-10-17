// Model ids and limits live here (and in env), never in prompts or docs.
export const config = {
  model: process.env.AGENT_MODEL ?? "claude-haiku-5-5",
  // Server-side fallback is offered for Opus and Sonnet, not Haiku.
  serverFallback: !/haiku/.test(process.env.AGENT_MODEL ?? "claude-haiku-5-5"),
  effort: (process.env.AGENT_EFFORT ?? "low") as "low" | "medium" | "high",
  maxTokens: Number(process.env.AGENT_MAX_TOKENS ?? 1024),
  maxToolRounds: 4,
  embedModel: "Xenova/bge-small-en-v1.5",
  embedQueryPrefix: "Represent this sentence for searching relevant passages: ",
  retrievalK: Number(process.env.RETRIEVAL_K ?? 5),
  minRetrievalScore: Number(process.env.MIN_RETRIEVAL_SCORE ?? 0.55),
  bookingsPerSession: Number(process.env.BOOKINGS_PER_SESSION ?? 2),
  maxSlotsShown: 4,
  tz: "America/Chicago",
  // Demo "now". The partner data's today is 2026-10-16; slots run to 2026-11-05.
  nowOverride: process.env.DEMO_NOW,
  promptVersion: "agent-v5",
};

export const now = () => (config.nowOverride ? new Date(config.nowOverride) : new Date());
