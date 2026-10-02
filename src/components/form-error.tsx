import { AlertIcon } from "./icons";

/** Errors always carry an icon and a sentence, never color alone. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
