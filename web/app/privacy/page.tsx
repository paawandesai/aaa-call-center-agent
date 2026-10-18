import type { Metadata } from "next";
import { PrivacyText } from "@/components/PrivacyNotice";

export const dynamic = "force-dynamic"; // per-request CSP nonce, like every other page
export const metadata: Metadata = { title: "Privacy" };

// Public, like the invite page, so the notice can be read before and after signing in.
export default function Privacy() {
  return (
    <main className="page" style={{ maxWidth: 720, paddingTop: 48, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 className="h1" style={{ margin: 0 }}>Privacy notice</h1>
      <p style={{ margin: 0 }}><PrivacyText /></p>
      <p className="small muted" style={{ margin: 0 }}>This is a demo with synthetic data. Meridian Home Comfort is a fictional company.</p>
      <p className="small muted" style={{ margin: 0 }}>Built with the bge-small-en-v1.5 embedding model (BAAI, MIT License) and IBM Plex fonts (SIL Open Font License 1.1). <a href="/notices">Third-party notices</a></p>
      <a href="/chat">Back to the chat</a>
    </main>
  );
}
