import { redirect } from "next/navigation";
import { HandoffActions } from "@/components/HandoffActions";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

interface H { id: number; created_at: Date; reason: string; intent: string | null; steps_tried: string[]; caller_provided: Record<string, unknown>; slot: unknown; summary: string; status: string }

export default async function Handoffs() {
  if (!(await requireSession("staff"))) redirect("/");
  const { rows } = await db().query<H>(`SELECT id, created_at, reason, intent, steps_tried, caller_provided, slot, summary, status FROM handoffs
    WHERE created_at > now() - interval '7 days' ORDER BY (status = 'resolved'), (reason = 'safety') DESC, created_at ASC LIMIT 200`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <StaffNav current="/staff/handoffs" />
      <main className="page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px" }}>Handoff queue</h1>
        <p className="muted" style={{ margin: 0 }}>Safety first, then oldest. Caller details are unverified. Summaries are AI-written. Records older than 7 days are hidden and purged.</p>
        {rows.length === 0 && <p>No handoffs yet. Ask the assistant for a person to see one arrive.</p>}
        {rows.map((h) => (
          <article key={h.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 8, borderColor: h.reason === "safety" ? "var(--danger)" : undefined }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong className={h.reason === "safety" ? "bad" : undefined}>{h.reason.replace(/_/g, " ")}{h.intent ? ` · ${h.intent.replace(/_/g, " ")}` : ""}</strong>
              <span className="small muted mono">#{h.id} · {fmt.format(new Date(h.created_at))} Central · {h.status}</span>
            </div>
            <div className="small"><span className="muted">Caller gave (unverified): </span>{Object.entries(h.caller_provided).filter(([k]) => k !== "verified").map(([k, v]) => `${k} ${String(v)}`).join(", ") || "nothing"}</div>
            <div className="small"><span className="muted">Assistant steps: </span>{h.steps_tried.length ? h.steps_tried.join(" → ") : "none (routed by policy)"}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{h.summary}</div>
            <HandoffActions id={h.id} status={h.status} />
          </article>
        ))}
      </main>
    </>
  );
}
