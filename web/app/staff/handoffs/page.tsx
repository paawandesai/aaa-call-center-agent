import { redirect } from "next/navigation";
import { FlagButtons, HandoffActions } from "@/components/HandoffActions";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { openHandoffCount } from "@/lib/handoffs";
import { requireSession } from "@/lib/session";
import { REASON_LABEL, REASON_WHY, handoffTitle, waitingLabel } from "@/lib/staffcopy";

export const dynamic = "force-dynamic";

interface H { id: number; created_at: Date; reason: string; intent: string | null; steps_tried: string[]; caller_provided: Record<string, unknown>; slot: unknown; summary: string; status: string }

const STATUS_TAG: Record<string, string> = { open: "Waiting", claimed: "Claimed", resolved: "Resolved" };

function callerGave(p: Record<string, unknown>): string {
  const parts = Object.entries(p).filter(([k]) => k !== "verified").map(([k]) => (k === "zip" ? "a ZIP code" : k === "name" ? "a first name" : k));
  return parts.length ? `${parts.join(" and ").replace(/^./, (c) => c.toUpperCase())}. Not verified.` : "Nothing yet. Nothing was verified.";
}

export default async function Handoffs({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!(await requireSession("staff"))) redirect("/");
  const q = db();
  const { rows } = await q.query<H>(`SELECT id, created_at, reason, intent, steps_tried, caller_provided, slot, summary, status FROM handoffs
    WHERE created_at > now() - interval '7 days' ORDER BY (status = 'resolved'), (reason = 'safety') DESC, created_at ASC LIMIT 200`);
  const waiting = await openHandoffCount(q);
  const want = Number((await searchParams).id);
  const sel = rows.find((h) => h.id === want) ?? rows[0];
  const [summary, excerpt] = sel ? sel.summary.replace(/^AI-written: /, "").split("\nCaller's last message (redacted): ") : ["", ""];
  const caller = sel ? Object.fromEntries(Object.entries(sel.caller_provided).filter(([k]) => k !== "verified")) : {};
  return (
    <>
      <StaffNav current="/staff/handoffs" waiting={waiting} />
      <main className="staff-main">
        <h1 className="sr-only">Handoff queue</h1>
        <div className="split">
          <section className="listpane" aria-label="Handoffs">
            <div className="listpane-head"><span className="label">Waiting · safety first, then oldest</span></div>
            {rows.length === 0 ? <p className="empty">No handoffs in the last 7 days. Ask the assistant for a person in the chat to see one arrive.</p> : (
              <ul>
                {rows.map((h) => (
                  <li key={h.id}>
                    <a href={`?id=${h.id}`} aria-current={sel?.id === h.id ? "true" : undefined}>
                      <span className="row"><span style={{ fontWeight: 600 }}>{handoffTitle(h.reason, h.intent)}</span><span className="mono small muted">{waitingLabel(new Date(h.created_at))}</span></span>
                      <span className="tags">
                        <span className={`tag${h.reason === "safety" ? " danger" : ""}`}>{h.reason === "safety" ? "Safety · script sent" : REASON_LABEL[h.reason] ?? h.reason}</span>
                        <span className="tag">Chat</span>
                        {h.status !== "open" && <span className="tag">{STATUS_TAG[h.status]}</span>}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sel && (
            <article className="detail" aria-label="Handoff detail">
              <div className="detail-head">
                <div className="stack-4">
                  <span className="label">Handoff · chat · {sel.status === "open" ? `waiting ${waitingLabel(new Date(sel.created_at))}` : STATUS_TAG[sel.status]}</span>
                  <h2 className="h1">{handoffTitle(sel.reason, sel.intent)}</h2>
                </div>
                <HandoffActions key={sel.id} id={sel.id} status={sel.status} />
              </div>

              <div className="facts">
                <div className="stack-4"><span className="label">Why it came to you</span><span>{REASON_WHY[sel.reason] ?? sel.reason}</span></div>
                <div className="stack-4"><span className="label">Caller gave</span><span>{callerGave(caller)}</span>
                  {Object.keys(caller).length > 0 && <span className="mono small muted">{Object.entries(caller).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</span>}</div>
              </div>

              <section className="stack-8">
                <span className="label">Summary · AI-written, check with the caller</span>
                <p style={{ margin: 0, maxWidth: 680 }}>{summary}</p>
              </section>

              <section className="stack-8">
                <span className="label">What the assistant did</span>
                {sel.steps_tried.length ? (
                  <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                    {sel.steps_tried.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                ) : <p style={{ margin: 0 }}>Nothing beyond routing. A policy rule sent this to a person before the model answered.</p>}
              </section>

              <details style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 16px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500, minHeight: 28 }}>Caller&apos;s last message (personal details masked)</summary>
                <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: "20px" }}>{excerpt || "Not captured."}</p>
                <p className="small muted" style={{ margin: "8px 0 0" }}>Full transcripts are not stored. This excerpt is cut to 300 characters and purged after 7 days.</p>
              </details>

              <div className="detail-foot">
                <FlagButtons id={sel.id} />
                <span className="small muted">Flags go to the review queue. Nothing changes the assistant automatically.</span>
              </div>
            </article>
          )}
        </div>
      </main>
    </>
  );
}
