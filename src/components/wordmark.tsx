import Link from "next/link";

export function Wordmark({ href = "/", size = 28 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="font-display leading-none tracking-[-0.005em]" style={{ fontSize: size }}>
      AskDocs<span className="text-gold-text">.</span>
    </Link>
  );
}
