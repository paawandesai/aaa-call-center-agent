import { InviteForm } from "@/components/InviteForm";
import { SignOut } from "@/components/SignOut";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Gate() {
  // A signed-in visitor sees where to go next instead of being forwarded, so this page stays reachable.
  const session = await requireSession();
  return (
    <main className="page" style={{ maxWidth: 1040, paddingTop: 64, display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="label">AI call center agent · prototype</span>
        <h1 style={{ margin: 0, fontSize: 48, lineHeight: "52px", fontWeight: 600, letterSpacing: "-0.02em" }}>Meridian&apos;s automated assistant</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 460 }}>
          An AI assistant for a fictional heating, cooling and plumbing company. It answers routine questions from the company&apos;s documents,
          books visits into a test schedule, and hands everything else to a person.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>It is an AI and says so. It has no human name.</li>
          <li>Bookings write to a test database that resets every night.</li>
          <li>Handoffs go to a mock queue. No real person is contacted.</li>
        </ul>
      </div>
      {session ? (
        <section className="card" aria-labelledby="signed-in" style={{ flex: "1 1 380px", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 id="signed-in" style={{ margin: 0, fontSize: 18, lineHeight: "24px", fontWeight: 600 }}>You&apos;re signed in</h2>
          <p className="muted" style={{ margin: 0 }}>{session.role === "staff" ? "Staff code: chat, staff console and evaluation." : "Invite code: chat and evaluation."}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <a className="btn btn-primary" href="/chat" style={{ textDecoration: "none" }}>Continue to the chat</a>
            {session.role === "staff" && <a className="btn" href="/staff/handoffs" style={{ textDecoration: "none" }}>Staff console</a>}
            <a className="btn" href="/evaluation" style={{ textDecoration: "none" }}>Evaluation</a>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}><SignOut label="Use a different code" className="btn btn-quiet" /></div>
        </section>
      ) : <InviteForm />}
    </main>
  );
}
