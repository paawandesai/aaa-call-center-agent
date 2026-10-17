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
  embedQueryPrefix: "Represent this sentence for searching relevant passages: ",
  retrievalK: Number(process.env.RETRIEVAL_K ?? 5),
  minRetrievalScore: Number(process.env.MIN_RETRIEVAL_SCORE ?? 0.55),
  bookingsPerSession: Number(process.env.BOOKINGS_PER_SESSION ?? 2),
  demoBookingsPerDay: Number(process.env.DEMO_BOOKINGS_PER_DAY ?? 60),
  bookingAttemptsPerIpDay: Number(process.env.BOOKING_ATTEMPTS_PER_IP_DAY ?? 10),
  maxSlotsShown: 4,
  tz: "America/Chicago",
  // The partner data's today is 2026-10-16; slots run to 2026-11-05. DEMO_NOW pins the clock exactly (tests and the
  // eval, so runs are repeatable). CLOCK_FLOOR is for the live demo: the clock never reads earlier than it, but it
  // keeps moving with real time, so the app never offers or books a slot that has already passed.
  nowOverride: process.env.DEMO_NOW,
  clockFloor: process.env.CLOCK_FLOOR,
  promptVersion: "agent-v7",
};

export const now = () => {
  if (config.nowOverride) return new Date(config.nowOverride);
  const real = new Date();
  const floor = config.clockFloor ? new Date(config.clockFloor) : null;
  return floor && floor.getTime() > real.getTime() ? floor : real;
};
