import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "outline";

const base =
  "inline-flex h-12 items-center justify-center gap-2.5 rounded-[4px] px-5 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-gold text-on-gold hover:bg-gold-hover",
  outline: "border border-ink text-ink hover:bg-surface-raised",
};

function cls(variant: Variant, className?: string) {
  return `${base} ${variants[variant]}${className ? ` ${className}` : ""}`;
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cls(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cls(variant, className)} {...props} />;
}
