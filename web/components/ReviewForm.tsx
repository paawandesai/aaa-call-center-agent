"use client";
import { useState } from "react";

const FIXES = ["Update a knowledge base document", "Remove a document from the index", "Change an escalation rule", "Change the prompt", "Add as a test case only"];

export function ReviewForm({ turnId, flag }: { turnId: string; flag: string }) {
  const [real, setReal] = useState(true);
  const [fix, setFix] = useState(FIXES[0]);
  const [note, setNote] = useState("");
  const [reg, setReg] = useState(true);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  if (state === "saved") return <p className="ok" role="status" style={{ margin: 0 }}>Saved as a proposal. It ships only through a reviewed change and a new eval run.</p>;
  return (
    <form className="stack-8" style={{ gap: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }} onSubmit={async (e) => {
      e.preventDefault();
      const r = await fetch("/api/staff/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turn_id: turnId, flag, decision: real ? "needs_fix" : "disagree",
          proposed_fix: real ? `${fix}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 500) : note.trim().slice(0, 500) || undefined, add_to_regression: reg }) });
      setState(r.ok ? "saved" : "error");
    }}>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <legend className="label" style={{ marginBottom: 8 }}>Your call</legend>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 32 }}><input type="radio" name="d" checked={real} onChange={() => setReal(true)} />Real problem</label>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 32 }}><input type="radio" name="d" checked={!real} onChange={() => setReal(false)} />Not a problem</label>
      </fieldset>
      {real && (
        <div className="stack-4">
          <label htmlFor="fix" className="label">Proposed fix</label>
          <select id="fix" value={fix} onChange={(e) => setFix(e.target.value)} style={{ minHeight: 44, padding: "0 8px", maxWidth: 360 }}>
            {FIXES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      )}
      <div className="stack-4">
        <label htmlFor="note" className="label">Note</label>
        <textarea id="note" rows={2} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} style={{ padding: 8, maxWidth: 560 }}
          placeholder="What should change? No customer details." />
      </div>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} />Mark for the regression set (a person writes a synthetic case for it; no chat text is stored)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <button type="submit" className="btn btn-primary">Save review</button>
        <span className="small muted" style={{ maxWidth: 520 }}>Saving records a proposal. Fixes ship through a reviewed code or content change and a fresh eval run, never automatically.</span>
        {state === "error" && <span className="bad small" role="alert">That didn&apos;t save. Try again.</span>}
      </div>
    </form>
  );
}
