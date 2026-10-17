import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

export const COOKIE = "mhc_session";
const HOURS = 8;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return s;
}
// The cookie is signed over the session id and the current code for its role, so rotating INVITE_CODE or STAFF_CODE
// signs everyone with the old code out at once.
const codeFor = (role: "caller" | "staff") => (role === "staff" ? process.env.STAFF_CODE : process.env.INVITE_CODE) ?? "";
const sign = (id: string, role: "caller" | "staff") => createHmac("sha256", secret()).update(`${id}|${role}|${codeFor(role)}`).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Two demo codes: one for callers, one for staff pages. No real accounts exist.
export function roleForCode(code: string): "caller" | "staff" | null {
  const invite = process.env.INVITE_CODE, staff = process.env.STAFF_CODE;
  const c = code.trim();
  if (staff && safeEqual(c, staff)) return "staff";
  if (invite && safeEqual(c, invite)) return "caller";
  return null;
}

export async function createSession(role: "caller" | "staff") {
  const id = randomBytes(16).toString("base64url");
  await db().query(`INSERT INTO sessions (session_id, role, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`, [id, role, HOURS]);
  return { value: `${id}.${sign(id, role)}`, maxAge: HOURS * 3600 };
}

export interface Session { id: string; role: "caller" | "staff" }

// Called inside every route handler and server component that needs access (never only in proxy.ts).
export async function requireSession(role?: "staff"): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac || id.length > 64) return null;
  const { rows } = await db().query<{ role: "caller" | "staff" }>(`SELECT role FROM sessions WHERE session_id = $1 AND expires_at > now()`, [id]);
  const s = rows[0];
  if (!s || !safeEqual(mac, sign(id, s.role))) return null;
  if (role === "staff" && s.role !== "staff") return null;
  return { id, role: s.role };
}
