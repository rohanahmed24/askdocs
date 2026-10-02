import type { ComponentProps } from "react";

export function TextField({ label, id, ...props }: ComponentProps<"input"> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="h-12 rounded-[4px] border border-ink-muted bg-surface-raised px-4 text-[15px] text-ink placeholder:text-ink-muted"
        {...props}
      />
    </div>
  );
}
