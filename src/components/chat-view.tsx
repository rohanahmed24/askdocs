"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Citation } from "@/db/schema";
import type { ChatEvent } from "@/server/chat/answer";
import { AlertIcon, FileIcon, SendIcon, StopIcon } from "./icons";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  /** For an answer being written (`writing`), stopped by the user, or failed with `error`. */
  state?: "writing" | "stopped" | "error";
  error?: string;
};

type Props = {
  readyDocuments: number;
  initialMessages: { id: string; role: "user" | "assistant"; content: string; citations: Citation[] }[];
  initialRemaining: number;
  questionsPerHour: number;
  userInitials: string;
};

export function ChatView({ readyDocuments, initialMessages, initialRemaining, questionsPerHour, userInitials }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const newId = () => `local-${++idRef.current}`;

  // The answer shown in the Sources panel: the one the user picked, else the latest with citations.
  const withCitations = messages.filter((m) => m.role === "assistant" && m.citations.length > 0);
  const selected = withCitations.find((m) => m.id === selectedId) ?? withCitations.at(-1) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function patch(id: string, change: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...(typeof change === "function" ? change(m) : change) } : m)));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setQuestion("");
    setBusy(true);

    const answerId = newId();
    setMessages((current) => [
      ...current,
      { id: newId(), role: "user", content: text, citations: [] },
      { id: answerId, role: "assistant", content: "", citations: [], state: "writing" },
    ]);
    setSelectedId(null);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 429) setRemaining(0);
        patch(answerId, { state: "error", error: body?.error ?? "The answer could not be written. Try again." });
        return;
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handle(JSON.parse(line) as ChatEvent, answerId);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) patch(answerId, { state: "stopped" });
      else patch(answerId, { state: "error", error: "The connection was lost before the answer finished. Try again." });
      void err;
    } finally {
      abortRef.current = null;
      setBusy(false);
      // Streaming finished without a final event (for example the server stopped): do not stay "writing".
      patch(answerId, (m) => (m.state === "writing" ? { state: "error", error: "The answer stopped early. Try again." } : {}));
    }
  }

  function handle(event: ChatEvent, answerId: string) {
    if (event.type === "delta") {
      patch(answerId, (m) => ({ content: m.content + event.text }));
    } else if (event.type === "done") {
      patch(answerId, { content: event.answer, citations: event.citations, state: undefined });
      setRemaining(event.remaining);
    } else if (event.type === "error") {
      patch(answerId, { state: "error", error: event.message });
      setRemaining(event.remaining);
    }
  }

  const noDocuments = readyDocuments === 0;

  return (
    <div className="flex h-[calc(100dvh-12.5rem)] flex-col gap-6 md:h-[calc(100dvh-6rem)] xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
      <section className="flex min-h-0 min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">
            Chat · {readyDocuments} {readyDocuments === 1 ? "document" : "documents"} ready
          </p>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Ask your documents</h1>
        </header>

        <div className="flex min-h-0 grow flex-col gap-6 overflow-y-auto pr-1" role="log" aria-label="Conversation" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex max-w-xl flex-col gap-3 text-ink-muted">
              {noDocuments ? (
                <p className="flex items-start gap-2 text-ink">
                  <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" />
                  <span>
                    No document is ready yet. <Link href="/documents" className="underline underline-offset-4">Upload a document</Link>, wait for it to show Ready, then ask about it.
                  </span>
                </p>
              ) : (
                <>
                  <p className="text-lg text-ink">Ask anything the documents can answer.</p>
                  <p>Every answer cites the passages it came from. If your documents do not answer the question, it says so instead of guessing.</p>
                </>
              )}
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex items-start gap-3 self-end md:max-w-[580px]">
                <p className="whitespace-pre-wrap rounded-[10px] bg-surface-raised px-5 py-4 leading-relaxed">{m.content}</p>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-mono text-xs" aria-hidden="true">
                  {userInitials}
                </span>
              </div>
            ) : (
              <article key={m.id} className="flex max-w-[760px] flex-col gap-2.5">
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-ink-muted">
                  AskDocs · {m.state === "writing" ? "writing" : m.state === "stopped" ? "stopped" : m.state === "error" ? "could not answer" : `${m.citations.length} ${m.citations.length === 1 ? "source" : "sources"}`}
                </p>
                <div className="rounded-[10px] border-2 border-ink px-5 py-5 leading-[1.65] md:px-6">
                  {m.state === "error" ? (
                    <p role="alert" className="flex items-start gap-2 text-danger">
                      <AlertIcon size={18} className="mt-1 shrink-0" />
                      <span>{m.error}</span>
                    </p>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">
                        {m.content === "" && m.state === "writing" ? <span className="text-ink-muted">Searching your documents…</span> : renderAnswer(m, () => setSelectedId(m.id))}
                        {m.state === "writing" && m.content !== "" && <span aria-hidden="true" className="ml-0.5 inline-block h-[18px] w-0.5 bg-ink align-[-3px] motion-safe:animate-pulse" />}
                      </p>
                      {m.state === "stopped" && <p className="mt-3 text-sm text-ink-muted">You stopped this answer.</p>}
                    </>
                  )}
                </div>
                {/* Below xl the sources sit under the answer; on wide screens they are in the side panel. */}
                {m.citations.length > 0 && (
                  <ul className="flex flex-col gap-3 xl:hidden" aria-label="Sources">
                    {m.citations.map((c) => (
                      <li key={c.n}>
                        <SourceCard citation={c} />
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="flex flex-col gap-2.5">
          <div className="flex h-[60px] items-center gap-3 rounded-[4px] border border-ink-muted bg-surface-raised pl-5 pr-2">
            <label htmlFor="question" className="sr-only">
              Ask a question about your documents
            </label>
            <input
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              autoComplete="off"
              disabled={busy || remaining === 0}
              placeholder={remaining === 0 ? "You have reached the question limit" : "Ask about your documents"}
              className="min-w-0 grow bg-transparent text-base text-ink placeholder:text-ink-muted focus-visible:shadow-none disabled:cursor-not-allowed"
            />
            {busy ? (
              <button
                type="button"
                aria-label="Stop generating"
                onClick={() => abortRef.current?.abort()}
                className="flex size-11 shrink-0 items-center justify-center rounded-[4px] bg-gold text-on-gold hover:bg-gold-hover"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send question"
                disabled={question.trim() === "" || remaining === 0}
                className="flex size-11 shrink-0 items-center justify-center rounded-[4px] bg-gold text-on-gold hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendIcon />
              </button>
            )}
          </div>
          <p className="text-sm text-ink-muted">
            {remaining} of {questionsPerHour} questions left this hour · Answers use your documents only
          </p>
        </form>
      </section>

      <aside aria-label="Sources" className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-l border-line pl-8 xl:flex">
        <div className="flex flex-col gap-3">
          <p className="eyebrow">Sources</p>
          <h2 className="font-display text-3xl leading-[1.1]">
            {selected ? `${selected.citations.length} ${selected.citations.length === 1 ? "passage" : "passages"} cited` : "Nothing cited yet"}
          </h2>
        </div>
        {selected ? (
          <ul className="flex flex-col gap-3.5">
            {selected.citations.map((c) => (
              <li key={c.n}>
                <SourceCard citation={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-ink-muted">When an answer cites your documents, the exact passages appear here.</p>
        )}
        <p className="text-sm leading-relaxed text-ink-muted">Each citation points to the exact passage the answer used.</p>
      </aside>
    </div>
  );
}

function CitationChip({ n, onClick }: { n: number; onClick?: () => void }) {
  const className =
    "mx-1 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[4px] bg-gold-soft px-1 align-[1px] font-mono text-xs font-medium text-gold-text";
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`Source ${n}`} className={className}>
      {n}
    </button>
  ) : (
    <span className={className}>{n}</span>
  );
}

/** The answer text with **bold** and each [n] turned into a citation chip. */
function renderAnswer(message: UiMessage, onChip: () => void): ReactNode[] {
  const valid = new Set(message.citations.map((c) => c.n));
  return message.content.split(/(\[\d{1,2}\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    const cite = /^\[(\d{1,2})\]$/.exec(part);
    if (cite) {
      const n = Number(cite[1]);
      // While the answer is being written the sources are not known yet, so every number shows as a chip.
      if (message.state === "writing") return <CitationChip key={i} n={n} />;
      return valid.has(n) ? <CitationChip key={i} n={n} onClick={onChip} /> : null;
    }
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? <strong key={i} className="font-semibold">{bold[1]}</strong> : part;
  });
}

function SourceCard({ citation }: { citation: Citation }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[10px] border-2 border-ink p-[18px]">
      <div className="flex items-center gap-2.5">
        <CitationChip n={citation.n} />
        <FileIcon size={16} className="shrink-0 text-ink-muted" />
        <span className="min-w-0 truncate text-[15px] font-medium">{citation.filename}</span>
      </div>
      <p className="font-mono text-xs text-ink-muted">Passage {citation.ordinal + 1}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">…{citation.text.trim()}…</p>
    </div>
  );
}
