import type { Metadata } from 'next';
import Link from 'next/link';
import { requireBook } from '@/src/access/page';
import { getDatabase } from '@/src/db/boot';
import { RecurringManager } from '@/src/recurring/RecurringManager';
import { listRecurring } from '@/src/recurring/recurring';
import { PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Bills' };

/** Recurring entries (DESIGN.md §8): what repeats, when it is next due, and whether it posts itself. */
export default async function Page() {
  const { accountId, book } = await requireBook();
  const rows = await listRecurring(await getDatabase(), accountId, book.id);
  return (
    <PageContainer>
      <PageHeader title="Bills" description="What repeats, and when it is next due." />
      <p>
        <Link href="/budget">Budget</Link>
      </p>
      <RecurringManager rows={rows} locale={book.locale ?? undefined} />
    </PageContainer>
  );
}
