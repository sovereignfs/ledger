/** A real calendar day written `YYYY-MM-DD`, in no time zone (DESIGN.md §18.2): 2026-02-30 is not one, and neither is 2026-2-3. */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Today's date in an IANA time zone, as `YYYY-MM-DD`: what "today" is for a book is the day on its own clock (DESIGN.md §15.2), not the server's. A zone that is
 * not one falls back to UTC rather than failing a page. `now` is given, so a test needs no clock.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
