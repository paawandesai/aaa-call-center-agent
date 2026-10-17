import { redirect } from "next/navigation";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { openHandoffCount } from "@/lib/handoffs";
import { spendToday } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { REASON_LABEL, shortId } from "@/lib/staffcopy";

export const dynamic = "force-dynamic";

// Everything here comes from first-party metadata (no chat text). This page never calls the model.
const RANGES: [string, string, number][] = [["24h", "24 h", 1], ["7d", "7 days", 7], ["30d", "30 days", 30]];
const INTENDED = new Set(["safety", "billing_account", "cancel_reschedule", "complaint", "human_requested", "service_area_unclear", "out_of_scope"]);
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (d: Date | string | null) => (d ? fmt.format(new Date(d)) : "never");

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  if (!(await requireSession("staff"))) redirect("/");
  const q = db();
  const want = (await searchParams).range;
  const range = RANGES.find(([id]) => id === want) ?? RANGES[1];
  const days = range[2];
  const conv = `coalesce(meta->>'conversation', session_id)`;
  const k = (await q.query<{ convs: number; handed: number; turns: number; errors: number; p50: number | null; p95: number | null }>(`
    WITH c AS (SELECT ${conv} AS c, bool_or(outcome IN ('handoff','safety')) AS handed FROM events
      WHERE kind = 'turn' AND ts > now() - make_interval(days => $1) GROUP BY 1)
    SELECT (SELECT count(*)::int FROM c) AS convs, (SELECT count(*)::int FROM c WHERE handed) AS handed,
      count(*)::int AS turns, count(*) FILTER (WHERE outcome = 'error')::int AS errors,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms) AS p95
    FROM events WHERE kind = 'turn' AND ts > now() - make_interval(days => $1)`, [days])).rows[0];
  const failedBookings = (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM events WHERE kind = 'booking' AND outcome <> 'booked' AND ts > now() - make_interval(days => $1)`, [days])).rows[0].n;
  const reasons = (await q.query<{ reason: string; n: number }>(`SELECT reason, count(DISTINCT ${conv})::int AS n FROM events
    WHERE kind = 'turn' AND reason IS NOT NULL AND ts > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC`, [days])).rows;
  const perDay = (await q.query<{ day: string; contained: number; handed: number }>(`
    WITH c AS (SELECT ${conv} AS c, min(ts) AS ts, bool_or(outcome IN ('handoff','safety')) AS handed FROM events
      WHERE kind = 'turn' AND ts > now() - make_interval(days => $1) GROUP BY 1)
    SELECT to_char(date_trunc('day', ts AT TIME ZONE 'America/Chicago'), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE NOT handed)::int AS contained, count(*) FILTER (WHERE handed)::int AS handed
    FROM c GROUP BY 1 ORDER BY 1`, [days])).rows;
  const failures = (await q.query<{ ts: Date; session_id: string | null; kind: string; outcome: string; reason: string | null }>(`
    SELECT ts, session_id, kind, outcome, reason FROM events
    WHERE (kind = 'turn' AND (outcome = 'error' OR reason = 'booking_failed')) OR (kind = 'booking' AND outcome <> 'booked') OR kind = 'rate_limit'
    ORDER BY ts DESC LIMIT 8`)).rows;
  const health = (await q.query<{ last_reply: Date | null; chunks: number; embed: string | null; last_reset: string | null }>(`
    SELECT (SELECT max(ts) FROM events WHERE kind = 'turn' AND outcome <> 'error' AND coalesce(output_tokens, 0) > 0) AS last_reply,
      (SELECT count(*)::int FROM kb_chunks) AS chunks, (SELECT min(embed_model) FROM kb_chunks) AS embed,
      (SELECT value FROM app_meta WHERE key = 'last_reset') AS last_reset`)).rows[0];
  const waiting = await openHandoffCount(q);
  const spend = spendToday();
  const resetOk = !!health.last_reset && Date.now() - new Date(health.last_reset).getTime() < 26 * 3600_000;

  const thin = k.convs < 20;
  const pct = (n: number) => (k.convs ? `${Math.round((100 * n) / k.convs)}%` : "–");
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));
  const maxDay = Math.max(1, ...perDay.map((d) => d.contained + d.handed));
  const W = 640, H = 200, base = 180, slot = W / Math.max(perDay.length, 7), bw = Math.min(48, slot * 0.6);
  const y = (n: number) => (n / maxDay) * 160;
  const failKind = (f: (typeof failures)[number]) =>
    f.kind === "rate_limit" ? ["Rate limit hit", "429"] : f.kind === "booking" ? [f.outcome === "slot_taken" ? "Slot taken at confirm" : f.outcome === "cap_reached" ? "Booking cap reached" : "Booking error", f.outcome === "slot_taken" ? "409 · offered next slot" : f.outcome === "cap_reached" ? "429" : "500"]
      : f.reason === "booking_failed" ? ["Booking failed", "handed off"] : ["Model or tool error", "500 · retry offered"];

  return (
    <>
      <StaffNav current="/staff/dashboard" waiting={waiting} />
      <main className="staff-main">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h1 className="h1">Live traffic</h1>
          <nav className="seg" aria-label="Time range">
            {RANGES.map(([id, label]) => <a key={id} href={`?range=${id}`} aria-current={range[0] === id ? "true" : undefined}>{label}</a>)}
          </nav>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Includes synthetic demo activity, regenerated nightly, so the console has something to show. Real chats are counted alongside it.</p>
        {thin && <p className="muted" style={{ margin: 0 }}>Fewer than 20 conversations in this range, so treat these rates as too few to judge.</p>}

        <div className="tiles">
          <div className={`tile${thin ? " thin" : ""}`}><span className="label">Conversations</span><span className="value">{k.convs}</span><span className="small muted">{k.turns} turns · chat only (voice is not built)</span></div>
          <div className={`tile${thin ? " thin" : ""}`}><span className="label">Contained (live, unverified)</span><span className="value">{pct(k.convs - k.handed)}</span><span className="small muted">No handoff. The graded number is on <a href="/evaluation">Evaluation</a>.</span></div>
          <div className={`tile${thin ? " thin" : ""}`}><span className="label">Handed off</span><span className="value">{pct(k.handed)}</span><span className="small muted">{waiting} waiting now</span></div>
          <div className="tile"><span className="label">Failures</span><span className="value">{k.errors + failedBookings}</span><span className="small muted">Model or tool errors, failed bookings</span></div>
          <div className="tile"><span className="label">First reply · p50 / p95</span><span className="value">{k.p50 != null ? `${(k.p50 / 1000).toFixed(1)}s / ${((k.p95 ?? 0) / 1000).toFixed(1)}s` : "–"}</span><span className="small muted">Time to first streamed word</span></div>
        </div>

        <div className="row-wrap">
          <section className="panel" aria-labelledby="t1" style={{ flex: "2 1 520px" }}>
            <h2 id="t1" className="h2">Conversations per day, by outcome</h2>
            <div className="legend">
              <span><span className="swatch" style={{ background: "var(--accent)" }} aria-hidden="true" />Contained</span>
              <span><span className="swatch" style={{ background: "var(--line-strong)" }} aria-hidden="true" />Handed off</span>
            </div>
            {perDay.length === 0 ? <p className="muted" style={{ margin: 0 }}>No conversations in this range yet.</p> : (
              <svg role="img" aria-label={`Stacked bars for ${perDay.length} days; the table below has the counts`} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 200 }}>
                <line x1="0" y1={base} x2={W} y2={base} stroke="var(--line)" />
                <line x1="0" y1={base - 80} x2={W} y2={base - 80} stroke="var(--line)" strokeDasharray="2 4" />
                <line x1="0" y1={base - 160} x2={W} y2={base - 160} stroke="var(--line)" strokeDasharray="2 4" />
                {perDay.map((d, i) => {
                  const x = i * slot + (slot - bw) / 2, hc = y(d.contained), hh = y(d.handed);
                  return (
                    <g key={d.day}>
                      <title>{`${d.day}: ${d.contained} contained, ${d.handed} handed off`}</title>
                      {hc > 0 && <rect x={x} y={base - hc} width={bw} height={hc} fill="var(--accent)" rx="2" />}
                      {hh > 0 && <rect x={x} y={base - hc - hh - (hc > 0 ? 2 : 0)} width={bw} height={hh} fill="var(--line-strong)" rx="2" />}
                      <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--ink-muted)" fontFamily="var(--font-mono)">{d.day.slice(5)}</text>
                    </g>
                  );
                })}
              </svg>
            )}
            <details>
              <summary className="small" style={{ color: "var(--accent)", cursor: "pointer", minHeight: 32 }}>View as table</summary>
              <div className="table-wrap" tabIndex={0}><table>
                <thead><tr><th>Day (Central)</th><th>Contained</th><th>Handed off</th></tr></thead>
                <tbody>{perDay.map((d) => <tr key={d.day}><td className="mono">{d.day}</td><td className="mono">{d.contained}</td><td className="mono">{d.handed}</td></tr>)}</tbody>
              </table></div>
            </details>
          </section>

          <section className="panel" aria-labelledby="t2" style={{ flex: "1 1 320px" }}>
            <h2 id="t2" className="h2">Why conversations were handed off</h2>
            {reasons.length === 0 ? <p className="muted" style={{ margin: 0 }}>No handoffs in this range.</p> : (
              <div className="hbars">
                {reasons.map((r) => (
                  <div key={r.reason} style={{ display: "contents" }}>
                    <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                    <span className={`fill${INTENDED.has(r.reason) ? "" : " alt"}`} style={{ width: `${(100 * r.n) / maxReason}%` }} aria-hidden="true" />
                    <span className="mono">{r.n}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="small muted">Orange is a policy handoff. Grey means the assistant could not finish (low confidence or a failed booking).</span>
          </section>
        </div>

        <div className="row-wrap">
          <section className="panel" aria-labelledby="t3" style={{ flex: "1 1 360px" }}>
            <h2 id="t3" className="h2">System health</h2>
            <table>
              <tbody>
                <tr><td>Database</td><td className="ok">● Connected</td><td className="mono muted" style={{ textAlign: "right" }}>{when(new Date())}</td></tr>
                <tr><td>Last successful model reply</td><td className={health.last_reply ? "ok" : "muted"}>{health.last_reply ? "● OK" : "No replies yet"}</td><td className="mono muted" style={{ textAlign: "right" }}>{when(health.last_reply)}</td></tr>
                <tr><td>Knowledge index</td><td>{health.chunks} chunks · {health.embed ?? "–"}</td><td /></tr>
                <tr><td>Nightly reset and purge</td><td className={resetOk ? "ok" : "bad"}>{resetOk ? "● Ran on schedule" : "▲ Missed last run"}</td><td className="mono muted" style={{ textAlign: "right" }}>{when(health.last_reset)}</td></tr>
                <tr><td>Model spend today</td><td>${spend.usd.toFixed(2)} of ${spend.cap.toFixed(2)} cap</td><td className="small muted" style={{ textAlign: "right" }}>estimate since last restart</td></tr>
              </tbody>
            </table>
            <span className="small muted">Read from stored timestamps. This page never calls the model.</span>
          </section>

          <section className="panel" aria-labelledby="t4" style={{ flex: "1 1 360px" }}>
            <h2 id="t4" className="h2">Recent failures</h2>
            {failures.length === 0 ? <p className="muted" style={{ margin: 0 }}>None recorded.</p> : (
              <div className="table-wrap" tabIndex={0}><table>
                <thead><tr><th>When</th><th>Kind</th><th>Session</th><th>Status</th></tr></thead>
                <tbody>{failures.map((f, i) => { const [kind, status] = failKind(f); return (
                  <tr key={i}><td className="mono">{when(f.ts)}</td><td>{kind}</td><td className="mono">{shortId(f.session_id)}</td><td>{status}</td></tr>
                ); })}</tbody>
              </table></div>
            )}
            <span className="small muted">Opaque IDs and status codes only. No message text is logged here.</span>
          </section>
        </div>
      </main>
    </>
  );
}
