import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DocumentsView } from "@/components/documents-view";
import { db } from "@/db";
import { toDocumentDto } from "@/lib/documents-ui";
import { requireOrg } from "@/server/current-org";
import { getOrgScope } from "@/server/org-scope";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const { session, org } = await requireOrg();
  const scope = await getOrgScope(db, session.user.id, org.orgId);
  const documents = (await scope.listDocuments()).map(toDocumentDto);

  return (
    <AppShell org={org} user={session.user} active="documents">
      <DocumentsView
        orgName={org.name}
        initialDocuments={documents}
        storageUsedBytes={org.storageUsedBytes}
        storageLimitBytes={org.storageLimitBytes}
      />
    </AppShell>
  );
}
