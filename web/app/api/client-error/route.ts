import { z } from "zod";
import { CLIENT_ERROR_KINDS, CLIENT_ERROR_PAGES } from "@/lib/clienterror";
import { allow, clientIp } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";

// Browser errors, reported by components/ErrorReporter.tsx and the error pages. No session needed, because the invite page
// can fail before anyone signs in. Enums and an error class name only; the message and stack are never accepted.
const Body = z.object({
  kind: z.enum(CLIENT_ERROR_KINDS),
  page: z.enum(CLIENT_ERROR_PAGES),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/).optional(),
  digest: z.string().regex(/^[A-Za-z0-9]{1,32}$/).optional(),
}).strict();

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!allow(`cerr:${ip}`, 10, 60_000).ok || !allow(`cerrday:${ip}`, 100, 86_400_000).ok || !allow("cerr:all", 2000, 86_400_000).ok)
    return new Response(null, { status: 429 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return new Response(null, { status: 400 });
  const s = await requireSession();
  await record({ session_id: s?.id, kind: "client_error", outcome: b.data.kind, reason: b.data.page,
    meta: { name: b.data.name ?? null, digest: b.data.digest ?? null } });
  return new Response(null, { status: 204 });
}
