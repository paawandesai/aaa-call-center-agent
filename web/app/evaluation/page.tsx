import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Reads the committed results JSON. This page never runs the eval or calls the model.
interface Rate { k: number; n: number; rate: number; ci: [number, number] }
interface Results {
  run_id: string; created_at: string; config_id: string; prompt_version: string; split: string; note?: string;
  containment: Rate; ceiling: Rate; target: [number, number]; accuracy: Rate;
  escalation: { precision: Rate; recall: Rate }; retrieval?: { hit5: Rate; mrr: number; where: string };
  adversarial: Rate; safety: Rate;
  per_driver: { driver: string; n: number; contained: number; correct: number; failed: string[] }[];
  failures: { id: string; driver: string; expected: string; got: string; checks: string[] }[];
}

function load(): Results | null {
  try { return JSON.parse(readFileSync(path.join(process.cwd(), "eval-results", "latest.json"), "utf8")) as Results; } catch { return null; }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const R = ({ r }: { r: Rate }) => <span>{pct(r.rate)} <span className="muted small">({r.k}/{r.n}, 95% CI {pct(r.ci[0])}–{pct(r.ci[1])})</span></span>;

export default async function Evaluation() {
  if (!(await requireSession())) redirect("/");
  const r = load();
  if (!r) return <main className="page"><h1>How we measured</h1><p>No evaluation run has been committed yet.</p></main>;
  const scale = (x: number) => `${Math.min(100, Math.max(0, x * 100))}%`;
  return (
    <main className="page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <span className="label">Run {r.run_id} · config {r.config_id} · prompt {r.prompt_version} · {r.created_at.slice(0, 10)}</span>
        <h1 style={{ margin: "8px 0 0", fontSize: 28, lineHeight: "34px" }}>How we measured this assistant</h1>
        <p className="muted">Held-out split: {r.split}. Every rate shows n and a Wilson 95% confidence interval. Checks are deterministic (expected outcome, required facts, forbidden stale values); no model grades another model.</p>
        {r.note && <p>{r.note}</p>}
      </div>

      <section className="card" aria-labelledby="c">
        <h2 id="c" style={{ margin: "0 0 12px", fontSize: 18 }}>Containment vs ceiling vs target</h2>
        <div role="img" aria-label={`Containment ${pct(r.containment.rate)}, ceiling ${pct(r.ceiling.rate)}, target ${pct(r.target[0])} to ${pct(r.target[1])}`}
          style={{ position: "relative", height: 48, background: "var(--canvas)", border: "1px solid var(--line)", borderRadius: 3 }}>
          <div style={{ position: "absolute", left: scale(r.target[0]), width: `calc(${scale(r.target[1])} - ${scale(r.target[0])})`, top: 0, bottom: 0, background: "var(--accent-subtle)" }} />
          <div style={{ position: "absolute", left: scale(r.containment.ci[0]), width: `calc(${scale(r.containment.ci[1])} - ${scale(r.containment.ci[0])})`, top: 20, height: 8, background: "var(--line-strong)" }} />
          <div style={{ position: "absolute", left: scale(r.containment.rate), top: 8, bottom: 8, width: 3, background: "var(--accent)" }} />
          <div style={{ position: "absolute", left: scale(r.ceiling.rate), top: 0, bottom: 0, width: 2, background: "var(--ink)", borderLeft: "1px dashed var(--ink)" }} />
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, margin: "12px 0 0" }}>
          <dt className="muted">Containment (correct and contained)</dt><dd style={{ margin: 0 }}><R r={r.containment} /></dd>
          <dt className="muted">Ceiling (in-scope share of calls)</dt><dd style={{ margin: 0 }}><R r={r.ceiling} /></dd>
          <dt className="muted">Brief&apos;s target</dt><dd style={{ margin: 0 }}>{pct(r.target[0])}–{pct(r.target[1])}</dd>
        </dl>
      </section>

      <div className="kpis">
        <div className="card kpi"><div className="label">Accuracy on handled calls</div><div><R r={r.accuracy} /></div></div>
        <div className="card kpi"><div className="label">Escalation precision</div><div><R r={r.escalation.precision} /></div></div>
        <div className="card kpi"><div className="label">Escalation recall</div><div><R r={r.escalation.recall} /></div></div>
        <div className="card kpi"><div className="label">Safety calls handled by script</div><div><R r={r.safety} /></div></div>
        <div className="card kpi"><div className="label">Adversarial cases passed</div><div><R r={r.adversarial} /></div></div>
        {r.retrieval && <div className="card kpi"><div className="label">Retrieval hit@5 ({r.retrieval.where})</div><div><R r={r.retrieval.hit5} /> <span className="small muted">MRR {r.retrieval.mrr.toFixed(2)}</span></div></div>}
      </div>

      <section className="card" aria-labelledby="pd">
        <h2 id="pd" style={{ margin: "0 0 12px", fontSize: 18 }}>Per driver</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Driver</th><th>n</th><th>Contained</th><th>Correct</th><th>Failing cases</th></tr></thead>
          <tbody>{r.per_driver.map((d) => (
            <tr key={d.driver}><td>{d.driver}</td><td className="mono">{d.n}</td><td className="mono">{d.contained}</td><td className="mono">{d.correct}</td>
              <td className="mono small">{d.failed.map((id) => <a key={id} href={`#case-${id}`} style={{ marginRight: 8 }}>{id}</a>)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="card" aria-labelledby="fc">
        <h2 id="fc" style={{ margin: "0 0 12px", fontSize: 18 }}>Failing cases</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Driver</th><th>Expected</th><th>Got</th><th>Failed checks</th></tr></thead>
          <tbody>{r.failures.map((f) => (
            <tr key={f.id} id={`case-${f.id}`}><td className="mono">{f.id}</td><td>{f.driver}</td><td>{f.expected}</td><td>{f.got}</td><td className="small">{f.checks.join("; ")}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <p className="small"><a href="/chat">Back to the chat</a></p>
    </main>
  );
}
