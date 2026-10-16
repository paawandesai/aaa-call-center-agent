import { redirect } from "next/navigation";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const INTENDED = new Set(["safety", "billing_account", "cancel_reschedule", "complaint", "human_requested", "service_area_unclear", "out_of_scope"]);

export default async function Dashboard() {
  if (!(await requireSession("staff"))) redirect("/");
  const q = db();
  const k = (await q.query<{ convs: number; turns: number; handoffs: number; errors: number; booked: number; p50: number | null; p95: number | null }>(`
    SELECT count(DISTINCT session_id)::int AS convs, count(*)::int AS turns,
      count(*) FILTER (WHERE outcome IN ('handoff','safety'))::int AS handoffs,
      count(*) FILTER (WHERE outcome = 'error')::int AS errors,
      (SELECT count(*)::int FROM events WHERE kind = 'booking' AND outcome = 'booked' AND ts > now() - interval '7 days') AS booked,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms) AS p95
    FROM events WHERE kind = 'turn' AND ts > now() - interval '7 days'`)).rows[0];
  const reasons = (await q.query<{ reason: string; n: number }>(`SELECT reason, count(*)::int AS n FROM events
    WHERE kind = 'turn' AND reason IS NOT NULL AND ts > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const days = (await q.query<{ day: string; outcome: string; n: number }>(`SELECT to_char(date_trunc('day', ts AT TIME ZONE 'America/Chicago'),'YYYY-MM-DD') AS day,
    outcome, count(*)::int AS n FROM events WHERE kind = 'turn' AND ts > now() - interval '7 days' GROUP BY 1,2 ORDER BY 1`)).rows;
  const failures = (await q.query<{ ts: Date; turn_id: string; outcome: string; meta: Record<string, unknown> }>(`SELECT ts, turn_id, outcome, meta FROM events
    WHERE kind = 'turn' AND (outcome = 'error' OR reason IN ('low_confidence','booking_failed')) ORDER BY ts DESC LIMIT 10`)).rows;
  const max = Math.max(1, ...reasons.map((r) => r.n));
  const thin = k.turns < 20;
  const tile = (label: string, value: string, note: string) => (
    <div className={`card kpi${thin ? " thin" : ""}`}><div className="label">{label}</div><div className="value">{value}</div><div className="small muted">{note}</div></div>
  );
  const pct = (n: number) => (k.turns ? `${Math.round((100 * n) / k.turns)}%` : "–");
  return (
    <>
      <StaffNav current="/staff/dashboard" />
      <main className="page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px" }}>Last 7 days</h1>
        <p className="muted" style={{ margin: 0 }}>From first-party metadata only (no chat text). Live containment is unverified; the graded number comes from the evaluation run.{thin ? " Fewer than 20 turns so far: too few to judge." : ""}</p>
        <div className="kpis">
          {tile("Sessions", String(k.convs), `${k.turns} turns`)}
          {tile("Turns ending in handoff", pct(k.handoffs), `n=${k.handoffs} · unverified`)}
          {tile("Bookings", String(k.booked), "written to the test DB")}
          {tile("Errors", pct(k.errors), `n=${k.errors}`)}
          {tile("First reply p50 / p95", k.p50 ? `${(k.p50 / 1000).toFixed(1)}s / ${((k.p95 ?? 0) / 1000).toFixed(1)}s` : "–", "server-measured time to first token")}
        </div>
        <section className="card" aria-labelledby="hr">
          <h2 id="hr" style={{ margin: "0 0 12px", fontSize: 18 }}>Handoff reasons</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Reason</th><th>Type</th><th>Turns</th><th aria-hidden="true"></th></tr></thead>
            <tbody>{reasons.map((r) => (
              <tr key={r.reason}><td>{r.reason.replace(/_/g, " ")}</td><td>{INTENDED.has(r.reason) ? "intended (policy)" : "failure-driven"}</td><td className="mono">{r.n}</td>
                <td style={{ width: "40%" }} aria-hidden="true"><div className={`bar${INTENDED.has(r.reason) ? "" : " alt"}`} style={{ width: `${(100 * r.n) / max}%` }} /></td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="card" aria-labelledby="od">
          <h2 id="od" style={{ margin: "0 0 12px", fontSize: 18 }}>Outcomes per day</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Day (Central)</th><th>Outcome</th><th>Turns</th></tr></thead>
            <tbody>{days.map((d, i) => <tr key={i}><td className="mono">{d.day}</td><td>{d.outcome}</td><td className="mono">{d.n}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="card" aria-labelledby="rf">
          <h2 id="rf" style={{ margin: "0 0 12px", fontSize: 18 }}>Recent failures</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Turn</th><th>Outcome</th><th>Tools</th></tr></thead>
            <tbody>{failures.map((f) => <tr key={f.turn_id}><td className="mono">{new Date(f.ts).toISOString().slice(0, 16)}Z</td><td className="mono">{f.turn_id.slice(0, 8)}</td><td>{f.outcome}</td><td className="mono">{String(f.meta.tools ?? "")}</td></tr>)}</tbody>
          </table></div>
        </section>
      </main>
    </>
  );
}
