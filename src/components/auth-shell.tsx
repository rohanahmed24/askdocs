import Image from "next/image";
import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

/** Split layout for sign-in, sign-up and onboarding: form on the left, archive photo on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="flex flex-col px-6 py-8 md:px-14">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-12">{children}</div>
      </div>
      <div className="relative hidden md:block">
        <Image src="/images/auth-archive.webp" alt="" fill priority sizes="50vw" className="object-cover" />
      </div>
    </div>
  );
}
