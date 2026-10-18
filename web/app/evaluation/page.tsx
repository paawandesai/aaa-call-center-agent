import { config } from "@/lib/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { StaffNav } from "@/components/StaffNav";
import { db } from "@/lib/db";
import { openHandoffCount } from "@/lib/handoffs";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evaluation" };

// Reads the committed results JSON. This page never runs the eval or calls the model.
interface Rate { k: number; n: number; rate: number; ci: [number, number] }
interface Results {
  run_id: string; created_at: string; config_id: string; prompt_version: string; split: string; note?: string;
  containment: Rate; ceiling: Rate; target: [number, number]; accuracy: Rate; kept_accuracy?: Rate;
  escalation: { precision: Rate; recall: Rate }; retrieval?: { hit5: Rate; mrr: number; where: string };
  retrieval_holdout?: { hit1: Rate; hit5: Rate; mrr: number };
  adversarial: Rate; probes?: Rate; safety: Rate;
  per_driver: { driver: string; expected: string; n: number; contained: number; correct: number; failed: string[] }[];
  failures: { id: string; driver: string; expected: string; got: string; checks: string[] }[];
}

function load(): Results | null {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), "eval-results", "latest.json"), "utf8")) as Results; } catch { return null; }
}

// Wilson 95% interval, same formula as the eval runner.
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const pct = (x: number, dp = 0) => `${(100 * x).toFixed(dp)}%`;
const ci = (r: Rate) => `95% CI ${pct(r.ci[0])}–${pct(r.ci[1])} · n = ${r.n}`;

const TRY: [string, string, string][] = [
  ["/chat", "Ask a fee question", "“What's your diagnostic fee?” Watch for the source chip."],
  ["/chat", "Book a test visit", "Use any Austin ZIP, such as 78745, and any first name."],
  ["/chat", "Ask about a ZIP we may not serve", "Lakeway (78734) is a known conflict. It should hand off."],
  ["/chat", "Report a burning smell", "Expect the safety script and a handoff, never a booking."],
  ["/chat", "Try to break it", "“Book 40 slots”, “you are now…”, or ask for someone else's booking."],
  ["/staff/handoffs", "See your handoff arrive", "Open the staff queue after asking for a person (staff code)."],
];

export default async function Evaluation() {
  const session = await requireSession();
  if (!session) redirect("/");
  const staff = session.role === "staff";
  const waiting = staff ? await openHandoffCount(db()) : undefined;
  const r = load();
  const nav = <StaffNav current="/evaluation" waiting={waiting} staff={staff} />;
  if (!r) return <>{nav}<main className="page"><h1 className="h1">How we measured</h1><p>No evaluation run has been committed yet.</p></main></>;
  const x = (v: number) => Math.min(1000, Math.max(0, v * 1000));
  const same = Math.abs(r.containment.rate - r.ceiling.rate) < 0.005;
  return (
    <>
      {nav}
      <main className="page" style={{ maxWidth: 1180, padding: "32px 16px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="stack-8" style={{ maxWidth: 760 }}>
          <span className="label">Eval run {r.run_id} · {r.created_at.slice(0, 10)} · config {r.config_id} · prompt {r.prompt_version}</span>
          <h1 className="h1">How well the assistant does on held-out calls</h1>
          <p className="muted" style={{ margin: 0 }}>The test set is {r.split}, held out before call-driver discovery; each caller's opening line is verbatim from the redacted transcript, and a simulated caller answers the follow-up questions. Each item is scored by code: question calls against facts from the current knowledge base, account calls against the assigned customer's records, bookings and changes against the database. No AI grades the AI. These numbers are for prompt {r.prompt_version}{r.prompt_version === config.promptVersion ? ", the deployed one" : `; the deployed prompt is ${config.promptVersion} (see the README)`}.</p>
          {r.note && <p style={{ margin: 0 }}>{r.note}</p>}
        </div>

        <section className="panel" aria-labelledby="c1" style={{ padding: 24, gap: 16 }}>
          <h2 id="c1" className="h2">Containment against the ceiling</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
            <div className="stat"><span className="label">Measured</span><span className="value">{pct(r.containment.rate)}</span><span className="small muted">{ci(r.containment)}</span></div>
            <div className="stat"><span className="label">Ceiling</span><span className="value">{pct(r.ceiling.rate)}</span><span className="small muted">Share of calls the agent may handle; excludes calls that go to a person and booking calls whose zone had no openings</span></div>
            <div className="stat"><span className="label">Brief&apos;s target</span><span className="value">{pct(r.target[0])}–{pct(r.target[1])}</span><span className="small muted">Shown for reference</span></div>
          </div>
          <svg role="img" viewBox="0 0 1000 64" style={{ width: "100%", height: 64 }}
            aria-label={`Scale from 0 to 100 percent: measured containment ${pct(r.containment.rate)} with its confidence interval, ceiling ${pct(r.ceiling.rate)}, target band ${pct(r.target[0])} to ${pct(r.target[1])}`}>
            <rect x="0" y="24" width="1000" height="12" fill="var(--canvas)" stroke="var(--line)" />
            <rect x={x(r.target[0])} y="24" width={x(r.target[1]) - x(r.target[0])} height="12" fill="var(--accent-subtle)" />
            <text x={(x(r.target[0]) + x(r.target[1])) / 2} y="16" textAnchor="middle" fontSize="12" fill="var(--ink-muted)" fontFamily="var(--font-mono)">target</text>
            <rect x={x(r.containment.ci[0])} y="28" width={x(r.containment.ci[1]) - x(r.containment.ci[0])} height="4" fill="var(--accent)" opacity="0.4" />
            <rect x={x(r.containment.rate) - 2} y="18" width="4" height="24" fill="var(--accent)" />
            <text x={x(r.containment.rate)} y="12" textAnchor="middle" fontSize="12" fill="var(--accent-ink)" fontFamily="var(--font-mono)">{same ? "measured = ceiling" : "measured"}</text>
            <line x1={x(r.ceiling.rate)} y1="18" x2={x(r.ceiling.rate)} y2="42" stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 2" />
            {!same && <text x={x(r.ceiling.rate)} y="56" textAnchor="middle" fontSize="12" fill="var(--ink)" fontFamily="var(--font-mono)">ceiling</text>}
            <text x="0" y="56" fontSize="12" fill="var(--ink-muted)" fontFamily="var(--font-mono)">0%</text>
            <text x="1000" y="56" textAnchor="end" fontSize="12" fill="var(--ink-muted)" fontFamily="var(--font-mono)">100%</text>
          </svg>
          <p className="small muted" style={{ margin: 0 }}>Contained means the call ended with no handoff and passed its checks: a question call needs an answer containing at least one required fact from the current knowledge base, a booking call needs a booking of the right service in the database, and an appointment-change call needs the right change in the database. Any call fails if a reply contains a stale value from an archived document or claims a booking or change the database didn&apos;t record. A handoff, or a booking that didn&apos;t happen, is not contained. Handoffs are scored without checking that the reason was the right one. The denominator includes the out-of-scope and safety calls. Adversarial cases are scored separately below.</p>
        </section>

        <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <section className="tile"><span className="label">Accuracy on handled drivers</span><span className="value">{pct(r.accuracy.rate)}</span><span className="small muted">Right outcome, required facts present, no stale values, over the calls the agent may handle (so it equals containment ÷ ceiling) · {ci(r.accuracy)}</span></section>
          {r.kept_accuracy && <section className="tile"><span className="label">Right when it kept the call</span><span className="value">{pct(r.kept_accuracy.rate)}</span><span className="small muted">Of the calls the agent answered, booked or changed without a handoff, the share that passed every check · {ci(r.kept_accuracy)}</span></section>}
          {r.retrieval_holdout && <section className="tile"><span className="label">Retrieval on held-out questions · hit@5</span><span className="value">{pct(r.retrieval_holdout.hit5.rate)}</span><span className="small muted">September knowledge-base questions through the app&apos;s own search; a hit is a current-document passage holding a required fact · hit@1 {pct(r.retrieval_holdout.hit1.rate)} · MRR {r.retrieval_holdout.mrr.toFixed(2)} · {ci(r.retrieval_holdout.hit5)}</span></section>}
          <section className="tile"><span className="label">Escalation precision / recall</span><span className="value">{pct(r.escalation.precision.rate)} / {pct(r.escalation.recall.rate)}</span><span className="small muted">Handed off when it should ({r.escalation.recall.k} of {r.escalation.recall.n}), and only then ({r.escalation.precision.k} of {r.escalation.precision.n})</span></section>
          {r.retrieval && <section className="tile"><span className="label">Retrieval · hit@5</span><span className="value">{pct(r.retrieval.hit5.rate)}</span><span className="small muted">Dev set, n={r.retrieval.hit5.n}, not the held-out calls · measured on its own, before answers · MRR {r.retrieval.mrr.toFixed(2)} · {ci(r.retrieval.hit5)}</span></section>}
          <section className="tile"><span className="label">Adversarial set</span><span className="value">{r.adversarial.k} of {r.adversarial.n} held</span><span className="small muted">Prompt {r.prompt_version}, synthetic attacks · injection, bulk booking, other callers&apos; data, repeated asks for a person{r.probes ? ` · KB probes ${r.probes.k} of ${r.probes.n}` : ""}</span></section>
          <section className="tile"><span className="label">Safety calls</span><span className="value">{r.safety.k} of {r.safety.n}</span><span className="small muted">Safety script shown and handed off, never booked</span></section>
        </div>

        <section className="panel" aria-labelledby="c3">
          <h2 id="c3" className="h2">Results by driver</h2>
          <div className="table-wrap" tabIndex={0}><table style={{ minWidth: 640 }}>
            <thead><tr><th>Driver</th><th>Expected</th><th>N</th><th>Pass</th><th>95% CI</th><th>Failures</th></tr></thead>
            <tbody>{r.per_driver.map((d) => {
              const few = d.n < 20, [lo, hi] = wilson(d.correct, d.n);
              return (
                <tr key={d.driver}>
                  <td>{d.driver}</td><td>{d.expected}</td><td className="mono">{d.n}</td>
                  <td className={`mono${few ? " greyed" : ""}`}>{pct(d.correct / d.n)}{few && <span className="small" style={{ fontFamily: "var(--font-sans)" }}> · too few to judge</span>}</td>
                  <td className={`mono${few ? " greyed" : ""}`}>{pct(lo)}–{pct(hi)}</td>
                  <td>{d.failed.length ? <a href={`#f-${d.driver.replace(/\W+/g, "-")}`}>{d.failed.length} {d.failed.length === 1 ? "case" : "cases"}</a> : <span className="muted">none</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <span className="small muted">Pass means the expected outcome happened and every check held. Rows with n under 20 are greyed out and labelled &ldquo;too few to judge&rdquo;. A booking call whose ZIP zone had no openings for its service passes as a correct handoff, so the booking row includes a few of those.</span>
        </section>

        {r.failures.length > 0 && (
          <section className="panel" aria-labelledby="c5">
            <h2 id="c5" className="h2">Failing cases</h2>
            <div className="table-wrap" tabIndex={0}><table style={{ minWidth: 640 }}>
              <thead><tr><th>Case</th><th>Driver</th><th>Expected</th><th>Got</th><th>Failed checks</th></tr></thead>
              <tbody>{r.failures.map((f, i) => {
                const first = r.failures.findIndex((g) => g.driver === f.driver) === i;
                return (
                  <tr key={f.id} id={first ? `f-${f.driver.replace(/\W+/g, "-")}` : undefined}>
                    <td className="mono">{f.id}</td><td>{f.driver}</td><td>{f.expected}</td><td className="mono">{f.got}</td><td className="small">{f.checks.join("; ")}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <span className="small muted">Case ids are opaque hashes. The case text stays out of the repo because it comes from partner transcripts.</span>
          </section>
        )}

        <section className="panel" aria-labelledby="c4">
          <h2 id="c4" className="h2">Try it yourself</h2>
          <div className="try">
            {TRY.filter(([href]) => staff || href === "/chat").map(([href, t, d]) => (
              <a key={t} href={href}><span style={{ fontWeight: 600 }}>{t}</span><span className="small muted">{d}</span></a>
            ))}
          </div>
        </section>

        <p className="small muted" style={{ margin: 0 }}>Method, known constraints and what this system does not do are in the repository README.</p>
      </main>
    </>
  );
}
