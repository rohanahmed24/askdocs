import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ChatView } from "@/components/chat-view";
import { db } from "@/db";
import { checkQuestionLimit } from "@/server/chat/answer";
import { QUESTIONS_PER_HOUR } from "@/server/chat/limit";
import { requireOrg } from "@/server/current-org";
import { getOrgScope } from "@/server/org-scope";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const { session, org } = await requireOrg();
  const scope = await getOrgScope(db, session.user.id, org.orgId);
  const [documents, stored, limit] = await Promise.all([scope.listDocuments(), scope.listMessages(40), checkQuestionLimit(scope)]);

  return (
    <AppShell org={org} user={session.user} active="chat">
      <ChatView
        readyDocuments={documents.filter((d) => d.status === "ready").length}
        initialMessages={stored.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations }))}
        initialRemaining={limit.remaining}
        questionsPerHour={QUESTIONS_PER_HOUR}
        userInitials={session.user.name.slice(0, 2).toUpperCase()}
      />
    </AppShell>
  );
}
