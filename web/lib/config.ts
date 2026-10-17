// Model ids and limits live here (and in env), never in prompts or docs.
export const config = {
  model: process.env.AGENT_MODEL ?? "claude-haiku-5-5",
  // Server-side fallback is offered for Opus and Sonnet, not Haiku.
  serverFallback: !/haiku/.test(process.env.AGENT_MODEL ?? "claude-haiku-5-5"),
  safetyModel: process.env.SAFETY_MODEL ?? "claude-haiku-5-5",
  effort: (process.env.AGENT_EFFORT ?? "low") as "low" | "medium" | "high",
  maxTokens: Number(process.env.AGENT_MAX_TOKENS ?? 1024),
  maxToolRounds: 4,
  embedModel: "Xenova/bge-small-en-v1.5",
  // Pinned to one Hugging Face commit, so a rebuild can't fetch changed weights that no longer match the stored KB vectors.
  // The tag stored with each vector includes it, so changing the revision re-embeds the KB on the next deploy.
  embedRevision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  embedTag: "Xenova/bge-small-en-v1.5@ea104da",
  embedQueryPrefix: "Represent this sentence for searching relevant passages: ",
  retrievalK: Number(process.env.RETRIEVAL_K ?? 5),
  minRetrievalScore: Number(process.env.MIN_RETRIEVAL_SCORE ?? 0.55),
  bookingsPerSession: Number(process.env.BOOKINGS_PER_SESSION ?? 2),
  demoBookingsPerDay: Number(process.env.DEMO_BOOKINGS_PER_DAY ?? 60),
  bookingAttemptsPerIpDay: Number(process.env.BOOKING_ATTEMPTS_PER_IP_DAY ?? 10),
  maxSlotsShown: 4,
  tz: "America/Chicago",
  promptVersion: "agent-v8",
};

// DEMO_NOW pins the clock exactly (tests and the eval, so runs are repeatable). CLOCK_FLOOR is for the live demo: the
// clock never reads earlier than it, but it keeps moving with real time. Both are read on every call, not at import,
// because scripts and tests set DEMO_NOW after their imports have run.
export const now = () => {
  if (process.env.DEMO_NOW) return new Date(process.env.DEMO_NOW);
  const real = new Date();
  const floor = process.env.CLOCK_FLOOR ? new Date(process.env.CLOCK_FLOOR) : null;
  return floor && floor.getTime() > real.getTime() ? floor : real;
};
