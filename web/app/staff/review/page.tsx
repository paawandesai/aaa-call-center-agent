import { redirect } from "next/navigation";
import { ReviewForm } from "@/components/ReviewForm";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { openHandoffCount } from "@/lib/handoffs";
import { requireSession } from "@/lib/session";
import { REASON_LABEL, handoffTitle, shortId } from "@/lib/staffcopy";

export const dynamic = "force-dynamic";

// One queue built from metadata: caller thumbs-down, errors, low-confidence and failed-booking turns, plus staff flags from the handoff queue.
interface Item {
  key: string; ts: Date; kind: "caller_feedback" | "could_have_answered" | "error" | "booking_failed" | "summary_wrong" | "staff_could_have_answered";
  session_id: string | null; intent: string | null; outcome: string | null; reason: string | null; top_score: number | null;
  first_token_ms: number | null; latency_ms: number | null; tools: string | null; handoff_id: number | null; steps: string[] | null;
}

const KIND: Record<Item["kind"], { title: string; source: string; flag: string }> = {
  caller_feedback: { title: "Caller said it didn't help", source: "Caller thumbs-down", flag: "caller_feedback" },
  could_have_answered: { title: "Handed off for low confidence", source: "Automatic · low confidence", flag: "could_have_answered" },
  error: { title: "Turn ended in an error", source: "Automatic · error", flag: "other" },
  booking_failed: { title: "Booking could not be completed", source: "Automatic · booking failed", flag: "other" },
  summary_wrong: { title: "Handoff summary was wrong", source: "Staff flag · summary", flag: "other" },
  staff_could_have_answered: { title: "Assistant could have answered", source: "Staff flag · could have answered", flag: "could_have_answered" },
};

const FILTERS: [string, string, Item["kind"][] | null][] = [
  ["open", "Open", null],
  ["answer", "Could have answered", ["could_have_answered", "staff_could_have_answered"]],
  ["feedback", "Caller feedback", ["caller_feedback"]],
  ["errors", "Errors", ["error", "booking_failed"]],
  ["summary", "Summary wrong", ["summary_wrong"]],
];

const ms = (n: number | null) => (n == null ? "–" : `${(n / 1000).toFixed(1)} s`);

export default async function Review({ searchParams }: { searchParams: Promise<{ f?: string; k?: string }> }) {
  if (!(await requireSession("staff"))) redirect("/");
  const q = db();
  const sp = await searchParams;
  const { rows } = await q.query<Item>(`
    SELECT * FROM (
      SELECT e.turn_id AS key, e.ts,
        CASE WHEN f.rating = 'down' THEN 'caller_feedback' WHEN e.outcome = 'error' THEN 'error'
          WHEN e.reason = 'low_confidence' THEN 'could_have_answered' ELSE 'booking_failed' END AS kind,
        e.session_id, e.intent, e.outcome, e.reason, e.top_score, e.first_token_ms, e.latency_ms, e.meta->>'tools' AS tools,
        NULL::int AS handoff_id, NULL::jsonb AS steps
      FROM events e LEFT JOIN feedback f ON f.turn_id = e.turn_id
      WHERE e.kind = 'turn' AND (f.rating = 'down' OR e.outcome = 'error' OR e.reason IN ('low_confidence','booking_failed'))
      UNION ALL
      SELECT 'handoff:' || s.handoff_id || ':' || s.flag, s.created_at,
        CASE s.flag WHEN 'summary_wrong' THEN 'summary_wrong' ELSE 'staff_could_have_answered' END,
        h.session_id, h.intent, 'handoff', h.reason, NULL, NULL, NULL, NULL, h.id::int, h.steps_tried
      FROM staff_flags s JOIN handoffs h ON h.id = s.handoff_id
    ) x WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.turn_id = x.key)
    ORDER BY ts DESC LIMIT 100`);
  const waiting = await openHandoffCount(q);
  const filter = FILTERS.find(([id]) => id === sp.f) ?? FILTERS[0];
  const shown = filter[2] ? rows.filter((r) => filter[2]!.includes(r.kind)) : rows;
  const sel = shown.find((r) => r.key === sp.k) ?? shown[0];
  const href = (f: string, k?: string) => `?f=${f}${k ? `&k=${encodeURIComponent(k)}` : ""}`;
  return (
    <>
      <StaffNav current="/staff/review" waiting={waiting} />
      <main className="staff-main">
        <h1 className="sr-only">Review queue</h1>
        <div className="split">
          <section className="listpane" aria-label="Flagged conversations">
            <nav className="listpane-head filters" aria-label="Filter">
              {FILTERS.map(([id, label]) => <a key={id} href={href(id)} aria-current={filter[0] === id ? "true" : undefined}>{label}</a>)}
            </nav>
            {shown.length === 0 ? <p className="empty">Nothing to review here.</p> : (
              <ul>
                {shown.map((r) => (
                  <li key={r.key}>
                    <a href={href(filter[0], r.key)} aria-current={sel?.key === r.key ? "true" : undefined}>
                      <span style={{ fontWeight: 600 }}>{KIND[r.kind].title}</span>
                      <span className="small muted">{KIND[r.kind].source}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sel && (
            <article className="detail" aria-label="Review detail">
              <div className="stack-8">
                <span className="label">Session {shortId(sel.session_id)} · {KIND[sel.kind].source}</span>
                <h2 className="h1">{KIND[sel.kind].title}</h2>
                <p className="muted" style={{ margin: 0, maxWidth: 680 }}>Chat text is not written to the database, so this trace is metadata only. Ask the caller-facing team for context if the trace is not enough.</p>
              </div>

              <section className="stack-8">
                <span className="label">Trace</span>
                {sel.handoff_id ? (
                  <ol className="trace">
                    <li><span className="label">Route</span><span>Reason: {REASON_LABEL[sel.reason ?? ""] ?? sel.reason} · {handoffTitle(sel.reason ?? "", sel.intent)}</span><span /></li>
                    <li><span className="label">Steps</span><span>{sel.steps?.length ? sel.steps.join(" · ") : "Routed by policy before the model answered"}</span><span /></li>
                    <li><span className="label">Handoff</span><span><a href={`/staff/handoffs?id=${sel.handoff_id}`}>Open the handoff</a></span><span /></li>
                  </ol>
                ) : (
                  <ol className="trace">
                    <li><span className="label">Classify</span><span>Intent: {sel.intent?.replace(/_/g, " ") ?? "none matched"}</span><span /></li>
                    <li><span className="label">Retrieve</span><span>Top passage score {sel.top_score != null ? sel.top_score.toFixed(3) : "–"} (answers need 0.55 or more)</span><span /></li>
                    <li><span className="label">Answer</span><span>Tools used: {sel.tools || "none"}</span><span className="mono small muted">first word {ms(sel.first_token_ms)}</span></li>
                    <li><span className="label">Outcome</span><span className={sel.outcome === "error" ? "bad" : undefined}>{sel.outcome ?? "–"}{sel.reason ? ` · ${REASON_LABEL[sel.reason] ?? sel.reason}` : ""}</span><span className="mono small muted">total {ms(sel.latency_ms)}</span></li>
                  </ol>
                )}
              </section>

              <ReviewForm key={sel.key} turnId={sel.key} flag={KIND[sel.kind].flag} />
            </article>
          )}
        </div>
      </main>
    </>
  );
}
