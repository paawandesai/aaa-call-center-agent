// List prices in USD per million tokens (Claude API, checked 2026-10-17). Cache writes use the 5-minute TTL (1.25x input).
// Used for the spend cap and eval cost reports, so an unknown model falls back to the most expensive row.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface Usage { input: number; cacheRead: number; cacheWrite: number; output: number }
export const emptyUsage = (): Usage => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output };
}

// A chat turn's cost: the agent's tokens at its model plus the safety check's tokens at SAFETY_MODEL.
export function turnCostUsd(agentModel: string, safetyModel: string, r: { usage?: Usage; safetyUsage?: Usage }): number {
  return (r.usage ? costUsd(agentModel, r.usage) : 0) + (r.safetyUsage ? costUsd(safetyModel, r.safetyUsage) : 0);
}

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}
