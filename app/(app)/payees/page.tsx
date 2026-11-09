import type { Metadata } from 'next';
import Link from 'next/link';
import { requireBook } from '@/src/access/page';
import { getDatabase } from '@/src/db/boot';
import { listPayees } from '@/src/ledger/payees';
import { PayeesManager } from '@/src/payees/PayeesManager';
import { PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Payees' };

/** The payees (DESIGN.md §6.5): who was paid, remembered; `?archived=1` is the ones put away. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const archived = (await searchParams).archived === '1';
  const payees = await listPayees(await getDatabase(), accountId, book.id, {
    archived,
    limit: 200,
  });
  return (
    <PageContainer>
      <PageHeader
        title={archived ? 'Archived payees' : 'Payees'}
        description="Who was paid, remembered."
      />
      <p>
        <Link href={archived ? '/payees' : '/payees?archived=1'}>
          {archived ? 'Back to payees' : 'Archived payees'}
        </Link>
        {' · '}
        <Link href="/budget">Budget</Link>
      </p>
      <PayeesManager payees={payees} archived={archived} />
    </PageContainer>
  );
}
