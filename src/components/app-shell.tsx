import Link from "next/link";
import type { ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import { ChatIcon, FileIcon, UsersIcon } from "./icons";
import { SignOutButton } from "./sign-out-button";
import { Wordmark } from "./wordmark";

type Org = { name: string; role: "owner" | "member"; storageUsedBytes: number; storageLimitBytes: number };
type User = { name: string; email: string };

const nav = [
  { key: "documents", label: "Documents", href: "/documents", Icon: FileIcon, enabled: true },
  { key: "chat", label: "Chat", href: "/chat", Icon: ChatIcon, enabled: true },
  { key: "members", label: "Members", href: "/members", Icon: UsersIcon, enabled: false },
] as const;

export function AppShell({
  org,
  user,
  active,
  children,
}: {
  org: Org;
  user: User;
  active: (typeof nav)[number]["key"];
  children: ReactNode;
}) {
  const pct = org.storageLimitBytes > 0 ? Math.min(100, (org.storageUsedBytes / org.storageLimitBytes) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-[264px] shrink-0 flex-col gap-6 border-r border-line px-5 py-7 md:flex">
        <div className="px-1">
          <Wordmark href="/documents" />
        </div>
        <div className="flex items-center gap-3 rounded-[4px] border border-ink-muted px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[4px] bg-gold-soft font-display text-gold-text">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-medium">{org.name}</span>
            <span className="font-mono text-xs capitalize text-ink-muted">{org.role}</span>
          </span>
        </div>
        <nav aria-label="Workspace" className="flex flex-col gap-1">
          <p className="px-3 pb-2 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">Workspace</p>
          {nav.map(({ key, label, href, Icon, enabled }) =>
            enabled ? (
              <Link
                key={key}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={`flex h-11 items-center gap-3 rounded-[4px] px-3 ${
                  active === key ? "bg-surface-raised font-medium text-ink underline underline-offset-[6px]" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon /> {label}
              </Link>
            ) : (
              <span key={key} className="flex h-11 items-center gap-3 rounded-[4px] px-3 text-ink-muted/60" title="Coming soon">
                <Icon /> {label}
                <span className="ml-auto font-mono text-[11px] uppercase tracking-wider">Soon</span>
              </span>
            ),
          )}
        </nav>
        <div className="mt-auto flex flex-col gap-2.5 rounded-[10px] bg-surface-raised p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">Storage</span>
            <span className="text-sm">
              {formatBytes(org.storageUsedBytes)} of {formatBytes(org.storageLimitBytes)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-line" role="presentation">
            <div className="h-1 rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-3 px-1">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-mono text-xs">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <SignOutButton className="w-fit text-left text-sm text-ink-muted underline underline-offset-4 hover:text-ink" />
          </span>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="flex h-16 items-center justify-between border-b border-line px-4 md:hidden">
        <Wordmark href="/documents" size={26} />
        <SignOutButton className="h-11 px-2 text-sm text-ink-muted underline underline-offset-4" />
      </header>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-14 md:py-12">{children}</main>

      {/* Phone tab bar */}
      <nav aria-label="Main" className="sticky bottom-0 grid h-[72px] grid-cols-3 border-t border-line bg-surface md:hidden">
        {nav.map(({ key, label, href, Icon, enabled }) => {
          const on = active === key;
          const inner = (
            <>
              <Icon size={22} />
              <span className="text-xs">{label}</span>
            </>
          );
          const cls = `flex flex-col items-center justify-center gap-1 border-t-2 ${on ? "border-ink text-ink" : "border-transparent text-ink-muted"}`;
          return enabled ? (
            <Link key={key} href={href} className={cls} aria-current={on ? "page" : undefined}>
              {inner}
            </Link>
          ) : (
            <span key={key} className={`${cls} opacity-60`}>
              {inner}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
