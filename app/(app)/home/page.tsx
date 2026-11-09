import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { getDatabase } from '@/src/db/boot';
import { loadOverviewPage } from '@/src/overview/overview';
import { OverviewScreen } from '@/src/overview/OverviewScreen';

export const metadata: Metadata = { title: 'Overview' };

/** Overview (DESIGN.md §14.3), the front address for someone signed in; a book that is not set up is taken to the wizard from here (§15.3). */
export default async function Page() {
  const { accountId, book } = await requireBook();
  if (book.setupDoneAt === null) redirect('/setup');
  const page = await loadOverviewPage(await getDatabase(), accountId, book);
  return <OverviewScreen page={page} locale={book.locale ?? undefined} />;
}
