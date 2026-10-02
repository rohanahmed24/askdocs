import Image from "next/image";
import { ButtonLink } from "@/components/button";
import { Wordmark } from "@/components/wordmark";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <nav className="flex items-center gap-3">
          {session ? (
            <ButtonLink href="/documents">Open app</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/sign-in" variant="outline">
                Sign in
              </ButtonLink>
              <ButtonLink href="/sign-up" className="hidden sm:inline-flex">
                Get started
              </ButtonLink>
            </>
          )}
        </nav>
      </header>
      <main className="flex flex-1 flex-col items-start justify-center gap-10 py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-xl flex-col gap-6">
          <p className="eyebrow">Document Q&amp;A</p>
          <h1 className="font-display text-6xl leading-[0.95] md:text-8xl">Ask your documents.</h1>
          <p className="text-xl font-light leading-snug">
            Upload txt, md or pdf files to your organization. Ask a question and get an answer with a citation to the exact passage.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={session ? "/documents" : "/sign-up"}>{session ? "Open app" : "Create an account"}</ButtonLink>
          </div>
        </div>
        <div className="relative size-72 shrink-0 md:size-[420px]" aria-hidden="true">
          <Image
            src="/images/empty-stack.webp"
            alt=""
            fill
            priority
            sizes="420px"
            className="object-contain drop-shadow-[0_40px_60px_rgba(0,0,0,0.6)]"
          />
        </div>
      </main>
    </div>
  );
}
