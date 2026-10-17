import { redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { demoIdentities } from "@/lib/accounts";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await requireSession();
  if (!session) redirect("/");
  const demoIds = await demoIdentities(db()).catch(() => []);
  return <Chat role={session.role} demoIds={demoIds} />;
}
