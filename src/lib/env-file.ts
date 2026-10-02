// Helpers for writing a secret into a .env file without ever printing it.

/** Secrets the local form may set, with a check that catches a pasted wrong value early. */
export const SETTABLE_SECRETS = {
  OPENROUTER_API_KEY: { label: "OpenRouter API key", prefix: "sk-or-" },
} as const;

export type SecretName = keyof typeof SETTABLE_SECRETS;

/**
 * Returns an error message for a value that cannot be a valid secret, or null.
 * Whitespace is refused because a newline would add a second variable to the file.
 */
export function checkSecretValue(name: SecretName, value: string): string | null {
  const { prefix, label } = SETTABLE_SECRETS[name];
  if (value.length === 0) return `Paste the ${label}.`;
  if (/\s/.test(value)) return "The key must not contain spaces or line breaks. Copy it again.";
  if (value.length > 300) return "That is too long to be a key. Copy it again.";
  if (!value.startsWith(prefix)) return `A ${label} starts with "${prefix}". Copy it again.`;
  return null;
}

/** Sets `NAME=value` in the text of a .env file: replaces the existing line, or adds one at the end. */
export function setEnvValue(content: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, () => line);
  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${line}\n`;
}
