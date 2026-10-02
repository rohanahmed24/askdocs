export const QUESTIONS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;

/**
 * How many questions a user has left this hour. `times` are the user's questions
 * from the last hour, oldest first. When none is left, `retryAfterSeconds` says
 * when the oldest one leaves the window and a slot opens.
 */
export function questionBudget(times: Date[], now: Date = new Date(), limit: number = QUESTIONS_PER_HOUR): { remaining: number; retryAfterSeconds: number | null } {
  const inWindow = times.filter((t) => now.getTime() - t.getTime() < HOUR_MS);
  const remaining = Math.max(0, limit - inWindow.length);
  if (remaining > 0) return { remaining, retryAfterSeconds: null };
  const slotOpensAt = inWindow[inWindow.length - limit].getTime() + HOUR_MS;
  return { remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((slotOpensAt - now.getTime()) / 1000)) };
}

export function limitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You can ask ${QUESTIONS_PER_HOUR} questions per hour. Your next question is available in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
