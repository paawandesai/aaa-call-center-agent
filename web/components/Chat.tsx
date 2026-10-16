"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/events";

type SlotT = Extract<AgentEvent, { type: "slots" }>["slots"][number];
type Item =
  | { id: string; kind: "you"; text: string }
  | { id: string; kind: "assistant"; text: string; turnId: string; sources?: Extract<AgentEvent, { type: "sources" }>["sources"]; interrupted?: boolean; rated?: "up" | "down" }
  | { id: string; kind: "slots"; slots: SlotT[]; picked?: number; used: boolean; note?: string }
  | { id: string; kind: "confirm"; data: Omit<Extract<AgentEvent, { type: "confirm_request" }>, "type">; state: "open" | "sending" | "closed"; key: string }
  | { id: string; kind: "booked"; data: Omit<Extract<AgentEvent, { type: "booked" }>, "type"> }
  | { id: string; kind: "handoff"; data: Omit<Extract<AgentEvent, { type: "handoff" }>, "type"> }
  | { id: string; kind: "safety"; text: string }
  | { id: string; kind: "error"; code: string; retry?: () => void };

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
const GREETING = "Hi, this is Meridian's automated assistant. I'm an AI, not a person. I can answer questions about fees, hours, membership and warranties, and book a repair, tune-up or estimate. You can ask for a person at any time.";

const ERRORS: Record<string, string> = {
  rate_limited: "You're sending messages quickly. Wait a moment and try again.",
  capacity: "The demo has reached its daily usage limit. Please try again tomorrow, or ask for a person.",
  duplicate_turn: "That message was already handled.",
  turn_in_progress: "I'm still answering your last message.",
};

export function Chat() {
  const [items, setItems] = useState<Item[]>([{ id: "greet", kind: "assistant", text: GREETING, turnId: "greeting" }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [conversationId, setConversationId] = useState(rid);
  const abort = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bookedHeading = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [items, status]);

  const patch = (id: string, fn: (it: Item) => Item) => setItems((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));

  const run = useCallback(async (body: Record<string, unknown>, shown: string | null, turnId = rid()) => {
    if (busy) return;
    setBusy(true);
    setLive("Assistant is responding");
    const aId = rid();
    setItems((xs) => [...xs, ...(shown ? [{ id: rid(), kind: "you" as const, text: shown }] : []), { id: aId, kind: "assistant", text: "", turnId }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const t0 = performance.now();
    let ttft: number | undefined;
    let finalText = "";
    let interrupted = false;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ conversation_id: conversationId, turn_id: turnId, ...body }) });
      if (res.status === 401) { window.location.assign("/"); return; }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setItems((xs) => [...xs, { id: rid(), kind: "error", code: j.error ?? "server_error" }]);
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          const ev = JSON.parse(data.slice(6)) as AgentEvent;
          switch (ev.type) {
            case "status":
              setStatus(ev.phase === "searching_kb" ? "Checking Meridian's documents" : ev.phase === "checking_availability" ? "Checking the schedule" : "Preparing your booking details");
              break;
            case "text_delta":
              ttft ??= performance.now() - t0;
              finalText += ev.text;
              setStatus(null);
              patch(aId, (x) => (x.kind === "assistant" ? { ...x, text: x.text + ev.text } : x));
              break;
            case "sources":
              patch(aId, (x) => (x.kind === "assistant" ? { ...x, sources: ev.sources } : x));
              break;
            case "slots":
              setItems((xs) => [...xs, { id: rid(), kind: "slots", slots: ev.slots, used: false }]);
              break;
            case "confirm_request": {
              const { type: _t, ...data } = ev;
              setItems((xs) => [...xs.map((x) => (x.kind === "confirm" && x.state === "open" ? { ...x, state: "closed" as const } : x)),
                { id: rid(), kind: "confirm", data, state: "open", key: rid() }]);
              break;
            }
            case "booking_failed":
              setItems((xs) => [...xs, { id: rid(), kind: "slots", slots: ev.slots, used: false, note: "That time was just taken. Here are the next openings." }]);
              break;
            case "handoff": {
              const { type: _t, ...data } = ev;
              setItems((xs) => [...xs, { id: rid(), kind: "handoff", data }]);
              break;
            }
            case "safety":
              setItems((xs) => [...xs, { id: rid(), kind: "safety", text: ev.text }]);
              finalText ||= ev.text;
              break;
            case "error":
              setItems((xs) => [...xs, { id: rid(), kind: "error", code: ev.code,
                retry: ev.retryable ? () => void run(body, null, turnId) : undefined }]);
              break;
            case "booked":
            case "done":
              break;
          }
        }
      }
    } catch (e) {
      interrupted = (e as Error).name === "AbortError";
      if (!interrupted) setItems((xs) => [...xs, { id: rid(), kind: "error", code: "network", retry: () => void run(body, null, turnId) }]);
    } finally {
      setItems((xs) => xs.flatMap((x) => (x.id === aId ? (x.kind === "assistant" && !x.text ? [] : [{ ...x, interrupted } as Item]) : [x])));
      setBusy(false);
      setStatus(null);
      setLive(finalText || "Assistant finished");
      abort.current = null;
      composer.current?.focus();
      void fetch("/api/telemetry", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turn_id: turnId, ttft_ms: ttft ? Math.round(ttft) : undefined, total_ms: Math.round(performance.now() - t0), interrupted }) }).catch(() => {});
    }
  }, [busy, conversationId]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void run({ message: text }, text);
  };

  async function confirm(item: Extract<Item, { kind: "confirm" }>) {
    patch(item.id, (x) => ({ ...x, state: "sending" }) as Item);
    const r = await fetch("/api/bookings/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, slot_id: item.data.slot_id, name: item.data.name, idempotency_key: item.key }) });
    const j = await r.json().catch(() => ({ type: "booking_failed", reason: "error", slots: [] }));
    patch(item.id, (x) => ({ ...x, state: "closed" }) as Item);
    if (j.type === "booked") {
      setItems((xs) => [...xs, { id: rid(), kind: "booked", data: j }]);
      setLive(`Booked. ${j.service}, ${j.when_label}. Reference ${j.ref}.`);
      setTimeout(() => bookedHeading.current?.focus(), 50);
    } else if (j.reason === "slot_taken") {
      setItems((xs) => [...xs, { id: rid(), kind: "slots", slots: j.slots ?? [], used: false, note: "That time was just taken. Here are the next openings." }]);
    } else if (j.reason === "cap_reached") {
      setItems((xs) => [...xs, { id: rid(), kind: "error", code: "cap_reached" }]);
    } else {
      setItems((xs) => [...xs, { id: rid(), kind: "error", code: "booking_error" }]);
    }
  }

  async function rate(item: Extract<Item, { kind: "assistant" }>, rating: "up" | "down") {
    patch(item.id, (x) => ({ ...x, rated: rating }) as Item);
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_id: item.turnId, rating }) }).catch(() => {});
  }

  return (
    <div className="chat-shell" onKeyDown={(e) => { if (e.key === "Escape" && abort.current) abort.current.abort(); }}>
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="var(--accent)" strokeWidth="2" /><path d="M14 4v20M4 14h20" stroke="var(--accent)" strokeWidth="2" /></svg>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Meridian Home Comfort</span>
            <span className="small muted">Heating, cooling and plumbing · Austin</span>
          </div>
          <span className="pill">AUTOMATED ASSISTANT</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={busy} onClick={() => void run({ action: "human" }, "Talk to a person")}>Talk to a person</button>
          <button className="btn btn-quiet" onClick={() => { abort.current?.abort(); setConversationId(rid()); setItems([{ id: "greet", kind: "assistant", text: GREETING, turnId: "greeting" }]); }}>New chat</button>
        </div>
      </header>

      <div className="page chat-body">
        <main className="chat-main">
          <div className="sr-only" aria-live="polite">{live}</div>
          <div role="log" aria-label="Conversation" className="log">
            {items.map((it) => <Row key={it.id} it={it} busy={busy} onPick={(s, slotsId) => {
              patch(slotsId, (x) => ({ ...x, picked: s.slot_id, used: true }) as Item);
              void run({ action: "slot_selected", slot_id: s.slot_id }, s.window_label);
            }} onConfirm={confirm} onChangeTime={() => void run({ message: "I'd like a different time." }, "I'd like a different time.")}
              onRate={rate} bookedRef={bookedHeading} />)}
            {busy && status && <div className="typing" role="status">{status}<span className="dots" /></div>}
            {busy && !status && <div className="typing"><span className="dots">Assistant is typing</span></div>}
            <div ref={endRef} />
          </div>

          <div className="composer">
            <form onSubmit={(e) => { e.preventDefault(); send(); }}>
              <label htmlFor="msg" className="sr-only">Message</label>
              <textarea id="msg" ref={composer} rows={2} placeholder="Type your question" value={draft} maxLength={2000} autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              {busy ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button>
                : <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>Send</button>}
            </form>
            <p className="small muted" style={{ margin: "8px 0 0" }}>Answers are written by AI from Meridian&apos;s current documents and can be wrong. Sources are shown with each answer.</p>
          </div>
        </main>

        <aside aria-label="About this assistant" className="chat-rail">
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="label">I can help with</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Fees, hours and holidays</li><li>Comfort Club membership</li><li>Warranty terms</li><li>Service area</li><li>Booking a repair, tune-up or estimate</li>
            </ul>
          </section>
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="label">A person handles</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Your bill, payments and refunds</li><li>Changing or cancelling a visit</li><li>Complaints</li><li>Anything about your account</li>
            </ul>
          </section>
          <section role="note" className="card" style={{ borderColor: "var(--danger)", display: "flex", flexDirection: "column", gap: 6 }}>
            <strong className="bad">Smell gas or smoke?</strong>
            <span>Leave the house now and call 911. Don&apos;t use this chat for emergencies.</span>
          </section>
          <a href="/evaluation" className="small">How we measured this assistant</a>
        </aside>
      </div>
    </div>
  );
}

function Row({ it, busy, onPick, onConfirm, onChangeTime, onRate, bookedRef }: {
  it: Item; busy: boolean;
  onPick: (s: SlotT, slotsId: string) => void;
  onConfirm: (it: Extract<Item, { kind: "confirm" }>) => void;
  onChangeTime: () => void;
  onRate: (it: Extract<Item, { kind: "assistant" }>, r: "up" | "down") => void;
  bookedRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  switch (it.kind) {
    case "you":
      return <div className="msg you"><span className="label">You</span><div className="bubble">{it.text}</div></div>;
    case "assistant":
      return (
        <div className="msg">
          <span className="label">Assistant · AI</span>
          <div className="bubble">
            {it.text}
            {it.interrupted && <span className="small muted"> (interrupted)</span>}
            {it.sources && it.sources.length > 0 && (
              <div className="sources">
                <span className="label">Sources</span>
                <div className="chips">
                  {it.sources.map((s, i) => (
                    <span key={i} className="chip">{s.doc_title}{s.section ? ` · ${s.section}` : ""}<span className="muted">{s.effective_date ? ` · effective ${s.effective_date}` : ""}</span></span>
                  ))}
                </div>
              </div>
            )}
          </div>
          {it.turnId !== "greeting" && it.text && (
            <div style={{ display: "flex", gap: 8 }} aria-label="Rate this answer">
              <button className="btn btn-quiet" style={{ minHeight: 32, padding: "0 10px" }} aria-pressed={it.rated === "up"} onClick={() => onRate(it, "up")}>Helpful</button>
              <button className="btn btn-quiet" style={{ minHeight: 32, padding: "0 10px" }} aria-pressed={it.rated === "down"} onClick={() => onRate(it, "down")}>Not helpful</button>
            </div>
          )}
        </div>
      );
    case "slots":
      return (
        <div className="msg">
          <span className="label">Available times</span>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {it.note && <span>{it.note}</span>}
            {it.slots.length === 0 ? <span>No openings came back. Ask for a person and they&apos;ll find a time.</span> : (
              <div role="radiogroup" aria-label="Available times" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {it.slots.map((s) => (
                  <button key={s.slot_id} role="radio" aria-checked={it.picked === s.slot_id} className="slot" disabled={it.used || busy} onClick={() => onPick(s, it.id)}>
                    <span style={{ fontWeight: 600 }}>{s.window_label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    case "confirm":
      return (
        <div className="msg">
          <span className="label">Confirm details</span>
          <section aria-label="Booking details" className="card confirm">
            <h2 style={{ margin: 0, fontWeight: 600, fontSize: 18, lineHeight: "24px" }}>Please check these before I book</h2>
            <dl>
              <dt className="muted">Service</dt><dd>{it.data.service}</dd>
              <dt className="muted">When</dt><dd>{it.data.when_label}</dd>
              <dt className="muted">ZIP</dt><dd>{it.data.zip}</dd>
              <dt className="muted">Name</dt><dd>{it.data.name}</dd>
              <dt className="muted">Fee</dt><dd>{it.data.fee_label}</dd>
            </dl>
            {it.state !== "closed" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button className="btn btn-primary" disabled={it.state === "sending"} onClick={() => onConfirm(it)}>{it.state === "sending" ? "Booking…" : "Confirm booking"}</button>
                <button className="btn" disabled={it.state === "sending" || busy} onClick={onChangeTime}>Change time</button>
              </div>
            ) : <span className="small muted">This card is closed.</span>}
            <span className="small muted">Nothing is booked until you press Confirm. Repair prices are confirmed by the technician on site.</span>
          </section>
        </div>
      );
    case "booked":
      return (
        <div className="msg">
          <span className="label">Booking record</span>
          <section aria-label="Booking confirmed" className="card booked">
            <h2 ref={bookedRef} tabIndex={-1} className="ok" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>✓ Booked</h2>
            <span>{it.data.service} on {it.data.when_label}.{it.data.tech_first_name ? ` Your technician is ${it.data.tech_first_name}.` : ""}</span>
            <span className="mono small muted">Reference {it.data.ref}</span>
            <span className="small muted">To change or cancel, ask for a person and they&apos;ll take care of it.</span>
          </section>
        </div>
      );
    case "handoff":
      return (
        <div className="msg">
          <span className="label">Passed to our team</span>
          <section aria-label="Handoff" className="card handoff">
            <strong>A person on our team will pick this up.</strong>
            <span><span className="muted">What I&apos;ve passed on: </span>{it.data.summary_for_caller}</span>
            {it.data.queue_position !== undefined && <span className="small muted">Position in the test queue: {it.data.queue_position}</span>}
            <span className="small muted">Demo: this is a test queue. No real person will contact you.</span>
          </section>
        </div>
      );
    case "safety":
      return (
        <div className="msg">
          <section role="alert" className="card safety">
            <strong className="bad">⚠ Safety first</strong>
            <span>{it.text}</span>
          </section>
        </div>
      );
    case "error":
      return (
        <div role="alert" className="card" style={{ borderColor: "var(--danger)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="bad">{ERRORS[it.code] ?? (it.code === "cap_reached" ? "This demo allows two bookings per session. Ask for a person for more." : "Something went wrong on our side.")}</span>
          {it.retry && <button className="btn" onClick={it.retry}>Retry</button>}
        </div>
      );
  }
}
