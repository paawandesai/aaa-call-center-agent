"use client";
import { useState } from "react";

export function HandoffActions({ id, status }: { id: number; status: string }) {
  const [s, setS] = useState(status);
  async function act(action: "claim" | "resolve") {
    const r = await fetch("/api/staff/handoffs", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, resolution: action === "resolve" ? "test" : undefined }) });
    if (r.ok) setS(action === "claim" ? "claimed" : "resolved");
  }
  if (s === "resolved") return <span className="ok small">Resolved</span>;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {s === "open" && <button className="btn" onClick={() => act("claim")}>Claim</button>}
      <button className="btn" onClick={() => act("resolve")}>Resolve</button>
    </div>
  );
}
