import { redirect } from "next/navigation";
import { ReviewForm } from "@/components/ReviewForm";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

interface Flag { turn_id: string; ts: Date; flag: string; outcome: string | null; reason: string | null; top_score: number | null; latency_ms: number | null; first_token_ms: number | null; tools: string | null }

export default async function Review() {
  if (!(await requireSession("staff"))) redirect("/");
  const { rows } = await db().query<Flag>(`
    SELECT e.turn_id, e.ts, CASE WHEN f.rating = 'down' THEN 'caller_feedback' WHEN e.outcome = 'error' THEN 'other'
      WHEN e.reason = 'low_confidence' THEN 'could_have_answered' ELSE 'other' END AS flag,
      e.outcome, e.reason, e.top_score, e.latency_ms, e.first_token_ms, e.meta->>'tools' AS tools
    FROM events e LEFT JOIN feedback f ON f.turn_id = e.turn_id
    WHERE e.kind = 'turn' AND (f.rating = 'down' OR e.outcome = 'error' OR e.reason IN ('low_confidence','booking_failed'))
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.turn_id = e.turn_id)
    ORDER BY e.ts DESC LIMIT 50`);
  return (
    <>
      <StaffNav current="/staff/review" />
      <main className="page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px" }}>Review queue</h1>
        <p className="muted" style={{ margin: 0 }}>Turns flagged by callers (Not helpful), errors and low-confidence handoffs. Chat text is not stored, so the trace shows metadata only.
          Saving records a proposal; nothing is promoted into the knowledge base or prompts automatically.</p>
        {rows.length === 0 && <p>Nothing to review.</p>}
        {rows.map((r) => (
          <article key={r.turn_id} className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>{r.flag.replace(/_/g, " ")}</strong>
              <span className="mono small muted">turn {r.turn_id.slice(0, 8)} · {new Date(r.ts).toISOString().slice(0, 16)}Z</span>
            </div>
            <div className="small mono">outcome={r.outcome ?? "–"} reason={r.reason ?? "–"} top_retrieval_score={r.top_score?.toFixed(3) ?? "–"} first_token={r.first_token_ms ?? "–"}ms total={r.latency_ms ?? "–"}ms tools={r.tools || "none"}</div>
            <ReviewForm turnId={r.turn_id} flag={r.flag} />
          </article>
        ))}
      </main>
    </>
  );
}
