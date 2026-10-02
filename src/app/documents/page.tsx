import type { Metadata } from "next";
import Image from "next/image";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/button";
import { UploadIcon } from "@/components/icons";
import { requireOrg } from "@/server/current-org";

export const metadata: Metadata = { title: "Documents" };

const steps = [
  { n: "01", title: "Upload", body: "Add txt, md or pdf files, up to 10 MB each." },
  { n: "02", title: "We index it", body: "A background job reads, splits and embeds your file. You can leave the page." },
  { n: "03", title: "Ask", body: "Every answer cites the passage it came from." },
];

export default async function DocumentsPage() {
  const { session, org } = await requireOrg();

  return (
    <AppShell org={org} user={session.user} active="documents">
      <div className="flex h-full flex-col justify-between gap-12">
        <div className="flex flex-col-reverse items-start justify-between gap-8 lg:flex-row lg:items-end">
          <div className="flex max-w-xl flex-col gap-6">
            <p className="eyebrow">No documents yet</p>
            <h1 className="font-display text-5xl leading-[0.98] md:text-7xl">Upload your first document</h1>
            <p className="text-xl font-light leading-snug">
              AskDocs reads your files and answers from them, with a citation for every claim. Add a txt, md or pdf file to begin.
            </p>
            <div className="flex flex-col gap-3">
              <Button disabled className="self-start">
                <UploadIcon /> Upload documents
              </Button>
              <p className="font-mono text-xs text-ink-muted">Uploading arrives in the next phase of the build.</p>
            </div>
          </div>
          <div className="relative grid size-72 shrink-0 place-items-end md:size-[440px]" aria-hidden="true">
            <span className="outline-text absolute bottom-0 left-0 font-display text-[18rem] leading-[0.8] md:text-[27rem]">0</span>
            <Image
              src="/images/empty-stack.webp"
              alt=""
              width={880}
              height={880}
              priority
              className="relative size-full object-contain drop-shadow-[0_40px_60px_rgba(0,0,0,0.6)]"
            />
          </div>
        </div>
        <ol className="grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="flex flex-col gap-2.5 border-t border-line pt-5">
              <span className="eyebrow">{s.n}</span>
              <span className="font-display text-3xl leading-[1.1]">{s.title}</span>
              <span className="text-ink-muted">{s.body}</span>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}
