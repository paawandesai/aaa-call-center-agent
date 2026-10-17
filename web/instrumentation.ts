// Runs once when the server starts. Starts the timer for the nightly reset and retention purges (lib/reset.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startResetTimer } = await import("./lib/reset");
    startResetTimer();
  }
}
