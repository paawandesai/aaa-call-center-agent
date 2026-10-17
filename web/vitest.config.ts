import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, env: { DEMO_NOW: "2026-10-16T14:00:00Z" }, hookTimeout: 120_000 } });
