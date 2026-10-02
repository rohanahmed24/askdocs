"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  ACCEPTED_EXTENSIONS,
  checkFileBeforeUpload,
  fileTypeLabel,
  formatAdded,
  isWorking,
  needsPolling,
  statusLabels,
  type DocumentDto,
} from "@/lib/documents-ui";
import { formatBytes } from "@/lib/format";
import { Button } from "./button";
import { AlertIcon, CheckCircleIcon, ClockIcon, CloseIcon, FileIcon, LoaderIcon, TrashIcon, UploadIcon } from "./icons";

type Props = {
  orgName: string;
  initialDocuments: DocumentDto[];
  storageUsedBytes: number;
  storageLimitBytes: number;
};

type Notice = { id: number; text: string };

// The table needs about 900 px for its fixed columns. Below the xl breakpoint the list is shown as cards.
const COLUMNS = "xl:grid-cols-[minmax(0,1fr)_80px_72px_96px_176px_64px]";
const POLL_MS = 3000;

const steps = [
  { n: "01", title: "Upload", body: "Add txt, md or pdf files, up to 10 MB each." },
  { n: "02", title: "We index it", body: "A background job reads, splits and embeds your file. You can leave the page." },
  { n: "03", title: "Ask", body: "Every answer cites the passage it came from." },
];

export function DocumentsView({ orgName, initialDocuments, storageUsedBytes, storageLimitBytes }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeId = useRef(0);
  const uploadId = useRef(0);
  const docsRef = useRef(initialDocuments);

  const [docs, setDocs] = useState(initialDocuments);
  const [uploading, setUploading] = useState<{ id: number; name: string }[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  const addNotice = useCallback((text: string) => {
    noticeId.current += 1;
    const id = noticeId.current;
    setNotices((current) => [...current, { id, text }]);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/documents", { cache: "no-store" }).catch(() => null);
    if (!response) return; // offline: try again at the next poll
    if (response.status === 401) {
      router.push("/sign-in");
      return;
    }
    if (!response.ok) return;
    const { documents } = (await response.json()) as { documents: DocumentDto[] };

    // Tell screen reader users when a document finishes.
    const before = new Map(docsRef.current.map((d) => [d.id, d.status]));
    const finished = documents.filter((d) => {
      const previous = before.get(d.id);
      return previous !== undefined && isWorking(previous) && !isWorking(d.status);
    });
    if (finished.length > 0) {
      setAnnouncement(finished.map((d) => `${d.filename} is ${d.status === "ready" ? "ready" : "not indexed"}.`).join(" "));
    }
    setDocs(documents);
  }, [router]);

  // Poll only while something is being indexed, and not while the tab is hidden.
  const polling = needsPolling(docs);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  async function uploadFiles(files: File[]) {
    for (const file of files) {
      const problem = checkFileBeforeUpload(file);
      if (problem) {
        addNotice(`${file.name}: ${problem}`);
        continue;
      }

      uploadId.current += 1;
      const id = uploadId.current;
      setUploading((current) => [...current, { id, name: file.name }]);
      try {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/documents", { method: "POST", body: form });
        if (response.status === 401) {
          router.push("/sign-in");
          return;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          const text =
            body?.error ?? (response.status === 413 ? "Each file can be up to 10 MB. Compress the file or split it." : "The upload failed. Try again.");
          addNotice(`${file.name}: ${text}`);
        }
      } catch {
        addNotice(`${file.name}: The upload did not reach the server. Check your connection and try again.`);
      } finally {
        setUploading((current) => current.filter((u) => u.id !== id));
      }
      await refresh();
    }
    router.refresh(); // updates the storage meter in the sidebar
  }

  async function remove(doc: DocumentDto) {
    setConfirmingId(null);
    const response = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" }).catch(() => null);
    if (response && (response.status === 204 || response.status === 404)) {
      setDocs((current) => current.filter((d) => d.id !== doc.id));
      router.refresh();
      return;
    }
    const body = (await response?.json().catch(() => null)) as { error?: string } | null | undefined;
    addNotice(`${doc.filename}: ${body?.error ?? "The document could not be deleted. Try again."}`);
  }

  function chooseFiles() {
    inputRef.current?.click();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  const hasContent = docs.length > 0 || uploading.length > 0;
  const pct = storageLimitBytes > 0 ? Math.min(100, (storageUsedBytes / storageLimitBytes) * 100) : 0;
  const full = storageLimitBytes > 0 && storageUsedBytes >= storageLimitBytes;

  return (
    <div className="flex h-full flex-col gap-7">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files to upload"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ""; // lets the same file be chosen again
          void uploadFiles(files);
        }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {hasContent ? (
        <>
          <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-3">
              <p className="eyebrow">
                {orgName} · {docs.length} {docs.length === 1 ? "document" : "documents"}
              </p>
              <h1 className="font-display text-5xl leading-none md:text-6xl">Your documents</h1>
            </div>
            <Button onClick={chooseFiles} className="w-full md:w-auto">
              <UploadIcon /> Upload documents
            </Button>
          </header>

          {/* Storage line for phones; on wider screens the sidebar shows it. */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex justify-between font-mono text-xs text-ink-muted">
              <span>Storage</span>
              <span>
                {formatBytes(storageUsedBytes)} of {formatBytes(storageLimitBytes)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-line" role="presentation">
              <div className={`h-1 rounded-full ${full ? "bg-danger" : "bg-ink"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`hidden items-center gap-5 rounded-[10px] border-2 border-dashed bg-surface-raised px-6 py-5 md:flex ${
              dragging ? "border-gold" : "border-ink-muted"
            }`}
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-[4px] bg-gold-soft text-gold-text">
              <UploadIcon size={24} />
            </span>
            <div className="flex grow flex-col gap-1">
              <p className="text-lg font-medium">{dragging ? "Drop to upload" : "Drop files here to add them"}</p>
              <p className="text-sm text-ink-muted">
                txt, md and pdf · up to 10 MB each · {formatBytes(storageUsedBytes)} of {formatBytes(storageLimitBytes)} used
              </p>
            </div>
            <Button variant="outline" onClick={chooseFiles} className="h-11">
              Choose files
            </Button>
          </div>
        </>
      ) : (
        <EmptyHero onChoose={chooseFiles} dragging={dragging} onDrop={onDrop} onDragOver={() => setDragging(true)} onDragLeave={() => setDragging(false)} />
      )}

      {notices.length > 0 && (
        <ul className="flex flex-col gap-2">
          {notices.map((notice) => (
            <li key={notice.id} className="flex items-start gap-3 rounded-[4px] border border-danger/50 bg-surface-raised px-4 py-3">
              <p role="alert" className="flex grow items-start gap-2 text-sm text-danger">
                <AlertIcon size={16} className="mt-0.5 shrink-0" />
                <span>{notice.text}</span>
              </p>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
                className="flex size-8 shrink-0 items-center justify-center rounded-[4px] text-ink-muted hover:text-ink"
              >
                <CloseIcon size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasContent && (
        <>
          {/* Very wide screens: a table */}
          <div className="hidden overflow-hidden rounded-[10px] border border-line xl:block">
            <div className={`grid h-11 items-center gap-x-4 bg-surface-raised px-6 font-mono text-xs uppercase tracking-[0.12em] text-ink-muted ${COLUMNS}`}>
              <div>Name</div>
              <div>Size</div>
              <div>Chunks</div>
              <div>Added</div>
              <div>Status</div>
              <div className="sr-only">Actions</div>
            </div>
            {uploading.map((u) => (
              <div key={`up-${u.id}`} className={`grid min-h-16 items-center gap-x-4 border-t border-line px-6 ${COLUMNS}`}>
                <FileCell name={u.name} />
                <div className="text-sm text-ink-muted">—</div>
                <div className="text-sm text-ink-muted">—</div>
                <div className="text-sm text-ink-muted">Now</div>
                <span className="inline-flex items-center gap-2 text-sm">
                  <LoaderIcon size={18} className="motion-safe:animate-spin" /> Uploading
                </span>
                <div />
              </div>
            ))}
            {docs.map((doc) => (
              <div key={doc.id} className="border-t border-line">
                <div className={`grid min-h-16 items-center gap-x-4 px-6 py-3 ${COLUMNS}`}>
                  <FileCell name={doc.filename} error={doc.status === "failed" ? failureText(doc) : null} />
                  <div className="text-sm text-ink-muted">{formatBytes(doc.sizeBytes)}</div>
                  <div className="text-sm text-ink-muted">{doc.status === "ready" ? doc.chunkCount : "—"}</div>
                  <div className="text-sm text-ink-muted">{formatAdded(doc.createdAt)}</div>
                  <StatusLabel doc={doc} />
                  <div className="flex justify-end">
                    <DeleteButton doc={doc} onClick={() => setConfirmingId(doc.id)} />
                  </div>
                </div>
                {confirmingId === doc.id && <ConfirmDelete doc={doc} onConfirm={() => void remove(doc)} onCancel={() => setConfirmingId(null)} />}
              </div>
            ))}
          </div>

          {/* Phones, tablets and small laptops: cards */}
          <ul className="flex flex-col gap-2 xl:hidden">
            {uploading.map((u) => (
              <li key={`up-${u.id}`} className="flex items-center gap-3 rounded-[10px] bg-surface-raised p-3">
                <FileBox />
                <span className="min-w-0 grow truncate text-[15px] font-medium">{u.name}</span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <LoaderIcon size={16} className="motion-safe:animate-spin" /> Uploading
                </span>
              </li>
            ))}
            {docs.map((doc) => (
              <li key={doc.id} className="rounded-[10px] bg-surface-raised">
                <div className="flex items-center gap-3 p-3">
                  <FileBox />
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <span className="truncate text-[15px] font-medium">{doc.filename}</span>
                    <span className="truncate text-[13px] text-ink-muted">
                      {fileTypeLabel(doc.filename)} · {formatBytes(doc.sizeBytes)}
                      {doc.status === "ready" ? ` · ${doc.chunkCount} ${doc.chunkCount === 1 ? "chunk" : "chunks"}` : ""} · {formatAdded(doc.createdAt)}
                    </span>
                    {doc.status === "failed" && (
                      <span className="flex items-start gap-1.5 text-[13px] text-danger">
                        <AlertIcon size={14} className="mt-0.5 shrink-0" />
                        {failureText(doc)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip doc={doc} />
                    <DeleteButton doc={doc} onClick={() => setConfirmingId(doc.id)} />
                  </div>
                </div>
                {confirmingId === doc.id && <ConfirmDelete doc={doc} onConfirm={() => void remove(doc)} onCancel={() => setConfirmingId(null)} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function failureText(doc: DocumentDto): string {
  return doc.error ?? "This file could not be indexed. Delete it and upload it again.";
}

function FileBox() {
  return (
    <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface text-ink-muted">
      <FileIcon size={18} />
    </span>
  );
}

function FileCell({ name, error }: { name: string; error?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <FileBox />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-base font-medium">{name}</span>
          <span className="shrink-0 rounded-[4px] border border-ink-muted px-1.5 py-0.5 font-mono text-xs text-ink-muted">{fileTypeLabel(name)}</span>
        </div>
        {error && (
          <p className="flex items-start gap-1.5 text-sm text-danger">
            <AlertIcon size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function StatusLabel({ doc }: { doc: DocumentDto }) {
  if (doc.status === "ready") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-success">
        <CheckCircleIcon size={18} /> {statusLabels.ready}
      </span>
    );
  }
  if (doc.status === "processing") {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <LoaderIcon size={18} className="motion-safe:animate-spin" /> {statusLabels.processing}
      </span>
    );
  }
  if (doc.status === "queued") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
        <ClockIcon size={18} /> {statusLabels.queued}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm text-danger">
      <AlertIcon size={18} /> {statusLabels.failed}
    </span>
  );
}

const chipColor = { ready: "border-success text-success", processing: "border-ink text-ink", queued: "border-ink-muted text-ink-muted", failed: "border-danger text-danger" } as const;

function StatusChip({ doc }: { doc: DocumentDto }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[4px] border px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${chipColor[doc.status]}`}
    >
      {statusLabels[doc.status]}
    </span>
  );
}

function DeleteButton({ doc, onClick }: { doc: DocumentDto; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Delete ${doc.filename}`}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-[4px] text-ink-muted hover:text-ink"
    >
      <TrashIcon />
    </button>
  );
}

function ConfirmDelete({ doc, onConfirm, onCancel }: { doc: DocumentDto; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={`Delete ${doc.filename}?`} className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3 md:px-6">
      <p className="grow text-sm">
        Delete <span className="font-medium">{doc.filename}</span>? Its answers and passages are removed too. This cannot be undone.
      </p>
      <Button variant="outline" onClick={onCancel} className="h-11">
        Keep it
      </Button>
      <Button variant="danger" onClick={onConfirm} className="h-11">
        Delete
      </Button>
    </div>
  );
}

function EmptyHero({
  onChoose,
  dragging,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  onChoose: () => void;
  dragging: boolean;
  onDrop: (event: DragEvent) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex grow flex-col justify-between gap-12 rounded-[10px] ${dragging ? "outline-2 outline-dashed outline-gold outline-offset-8" : ""}`}
    >
      <div className="flex flex-col-reverse items-start justify-between gap-8 lg:flex-row lg:items-end">
        <div className="flex max-w-xl flex-col gap-6">
          <p className="eyebrow">No documents yet</p>
          <h1 className="font-display text-5xl leading-[0.98] md:text-7xl">Upload your first document</h1>
          <p className="text-xl font-light leading-snug">
            AskDocs reads your files and answers from them, with a citation for every claim. Add a txt, md or pdf file to begin, or drop it anywhere on this page.
          </p>
          <Button onClick={onChoose} className="self-start">
            <UploadIcon /> Upload documents
          </Button>
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
  );
}
