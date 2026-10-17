// Runs once when the server starts. Starts the timer for the nightly reset and retention purges (lib/reset.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startResetTimer } = await import("./lib/reset");
    startResetTimer();
    const { warmEmbeddings } = await import("./lib/embed");
    warmEmbeddings().catch((e) => console.error("embedding model failed to load:", e instanceof Error ? e.message : String(e)));
  }
}
