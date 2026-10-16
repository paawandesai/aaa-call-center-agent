import { redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  if (!(await requireSession())) redirect("/");
  return <Chat />;
}
