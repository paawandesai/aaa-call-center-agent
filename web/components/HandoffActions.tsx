"use client";
import { useState } from "react";

const RESOLUTIONS: [string, string][] = [["resolved_by_staff", "Resolved by staff"], ["callback_scheduled", "Callback scheduled"], ["no_action_needed", "No action needed"]];

export function HandoffActions({ id, status }: { id: number; status: string }) {
  const [s, setS] = useState(status);
  const [picking, setPicking] = useState(false);
  const [res, setRes] = useState(RESOLUTIONS[0][0]);
  const [err, setErr] = useState(false);
  async function act(action: "claim" | "resolve") {
    const r = await fetch("/api/staff/handoffs", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, resolution: action === "resolve" ? res : undefined }) });
    setErr(!r.ok);
    if (r.ok) { setS(action === "claim" ? "claimed" : "resolved"); setPicking(false); }
  }
  if (s === "resolved") return <span className="ok" role="status">Resolved</span>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {s === "open" && <button className="btn btn-primary" style={{ padding: "0 20px" }} onClick={() => act("claim")}>Claim</button>}
      {s === "claimed" && <span className="small muted" role="status">Claimed</span>}
      {!picking ? <button className="btn" onClick={() => setPicking(true)}>Resolve…</button> : (
        <>
          <label className="sr-only" htmlFor={`res-${id}`}>Resolution</label>
          <select id={`res-${id}`} value={res} onChange={(e) => setRes(e.target.value)} style={{ minHeight: 44, padding: "0 8px" }}>
            {RESOLUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn" onClick={() => act("resolve")}>Mark resolved</button>
          <button className="btn btn-quiet" onClick={() => setPicking(false)}>Cancel</button>
        </>
      )}
      {err && <span className="bad small" role="alert">That didn&apos;t save. Try again.</span>}
    </div>
  );
}

// Staff flags on a handoff show up in the review queue.
export function FlagButtons({ id }: { id: number }) {
  const [done, setDone] = useState<string | null>(null);
  async function flag(kind: "summary_wrong" | "could_have_answered", label: string) {
    const r = await fetch("/api/staff/flags", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoff_id: id, flag: kind }) });
    if (r.ok) setDone(label);
  }
  if (done) return <span className="small ok" role="status">Flagged: {done.toLowerCase()}.</span>;
  return (
    <>
      <button className="btn btn-quiet" style={{ color: "var(--ink)" }} onClick={() => flag("summary_wrong", "Summary was wrong")}>Flag: summary was wrong</button>
      <button className="btn btn-quiet" style={{ color: "var(--ink)" }} onClick={() => flag("could_have_answered", "Assistant could have answered")}>Flag: assistant could have answered</button>
    </>
  );
}
