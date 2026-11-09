import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { AccountDetail } from '@/src/accounts/AccountDetail';
import { todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { entriesOf, getAccount } from '@/src/ledger/accounts';

export const metadata: Metadata = { title: 'Account' };

/** One account (DESIGN.md §6.1): its balance in words, its entries, and what can be done to it. Another person's is a 404, as one that never was. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { accountId, book } = await requireBook();
  const { id } = await params;
  const database = await getDatabase();
  const account = await getAccount(database, accountId, book.id, id);
  if (!account) notFound();
  const entries = await entriesOf(database, accountId, book.id, id, { limit: 100 });
  return (
    <AccountDetail
      account={account}
      entries={entries}
      today={todayIn(book.timeZone)}
      locale={book.locale ?? undefined}
    />
  );
}
