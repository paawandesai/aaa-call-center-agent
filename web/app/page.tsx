import { redirect } from "next/navigation";
import { InviteForm } from "@/components/InviteForm";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Gate() {
  if (await requireSession()) redirect("/chat");
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
      <InviteForm />
    </main>
  );
}
