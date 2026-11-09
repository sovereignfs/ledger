import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { loadSetup } from '@/src/setup/setup';
import { SetupWizard } from '@/src/setup/SetupWizard';

export const metadata: Metadata = { title: 'Set up' };
export const dynamic = 'force-dynamic';

/**
 * Setup (DESIGN.md §15.3): a wizard of four steps, full-bleed and outside the shell. It is always reachable, so a person can come back to it; what is done is read
 * from the book, and the front address sends a book that is not set up here.
 */
export default async function Page() {
  const { accountId, book } = await requireBook();
  const state = await loadSetup(await getDatabase(), accountId, book);
  return (
    <SetupWizard initial={state} today={todayIn(book.timeZone)} locale={book.locale ?? undefined} />
  );
}
