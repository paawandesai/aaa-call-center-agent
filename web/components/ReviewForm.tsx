"use client";
import { useState } from "react";

export function ReviewForm({ turnId, flag }: { turnId: string; flag: string }) {
  const [decision, setDecision] = useState("needs_fix");
  const [fix, setFix] = useState("");
  const [reg, setReg] = useState(false);
  const [saved, setSaved] = useState(false);
  if (saved) return <span className="ok small">Saved as a proposal. It ships only through a reviewed change and a new eval run.</span>;
  return (
    <form style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} onSubmit={async (e) => {
      e.preventDefault();
      const r = await fetch("/api/staff/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turn_id: turnId, flag, decision, proposed_fix: fix || undefined, add_to_regression: reg }) });
      if (r.ok) setSaved(true);
    }}>
      <label className="small">Decision{" "}
        <select value={decision} onChange={(e) => setDecision(e.target.value)} style={{ minHeight: 36 }}>
          <option value="agree">Agree with flag</option><option value="disagree">Disagree</option><option value="needs_fix">Needs a fix</option>
        </select>
      </label>
      <label className="small" style={{ flex: "1 1 240px" }}><span className="sr-only">Proposed fix</span>
        <input type="text" placeholder="Proposed fix (optional)" value={fix} onChange={(e) => setFix(e.target.value)} maxLength={500} style={{ width: "100%", minHeight: 36, padding: "0 8px" }} />
      </label>
      <label className="small"><input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} /> Add to regression tests</label>
      <button className="btn" type="submit">Save</button>
    </form>
  );
}
