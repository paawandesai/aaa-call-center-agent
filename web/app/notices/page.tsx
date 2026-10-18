import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";

export const dynamic = "force-dynamic"; // per-request CSP nonce, like every other page
export const metadata: Metadata = { title: "Third-party notices" };

// Public, like /privacy: the license notices for the embedding model and fonts the app ships.
export default function Notices() {
  const text = readFileSync(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");
  return (
    <main className="page" style={{ maxWidth: 820, paddingTop: 48, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 className="h1" style={{ margin: 0 }}>Third-party notices</h1>
      <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
      <a href="/privacy">Back to the privacy notice</a>
    </main>
  );
}
