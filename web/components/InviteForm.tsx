"use client";
import { useState } from "react";

export function InviteForm() {
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return setError("Please tick the box to continue.");
    setBusy(true);
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    setBusy(false);
    if (r.ok) {
      const { role } = (await r.json()) as { role: string };
      window.location.assign(role === "staff" ? "/staff/handoffs" : "/chat");
    } else if (r.status === 429) setError("Too many attempts. Wait a few minutes and try again.");
    else setError("That code didn't work. Check it and try again.");
  }

  return (
    <form onSubmit={submit} className="card" style={{ flex: "1 1 380px", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, lineHeight: "24px", fontWeight: 600 }}>Enter your invite code</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="code" style={{ fontWeight: 500 }}>Invite code</label>
        <input id="code" type="text" className="mono" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)}
          style={{ minHeight: 44, padding: "0 12px" }} aria-describedby="code-help" required />
        <span id="code-help" className="small muted">Reviewers received a code with the submission. Staff use the staff code.</span>
      </div>
      <section aria-labelledby="privacy" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 id="privacy" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Privacy notice</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Chats are not stored. We keep metadata (timings, outcomes, handoff reasons) for 30 days to measure quality. Handoff summaries
          have contact details removed. Test bookings are wiped nightly. No third-party analytics run on this site. Please use made-up names.
        </p>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, minHeight: 44 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 18, height: 18, margin: "2px 0 0", accentColor: "var(--accent)" }} />
          <span>I understand this is a demo with synthetic data and that I&apos;m talking to an AI.</span>
        </label>
      </section>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Checking…" : "Start chatting"}</button>
      {error && <div role="alert" className="small bad">{error}</div>}
    </form>
  );
}
