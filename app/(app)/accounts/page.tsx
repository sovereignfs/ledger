import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { AccountsScreen, ArchivedScreen } from '@/src/accounts/AccountsScreen';
import { loadOverview } from '@/src/accounts/overview';
import { getDatabase } from '@/src/db/boot';
import { listAccounts } from '@/src/ledger/accounts';

export const metadata: Metadata = { title: 'Accounts' };

/** Accounts (DESIGN.md §14.3): what you have, what you owe, people, and the net worth; `?archived=1` is the accounts put away. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const database = await getDatabase();
  const query = await searchParams;
  const locale = book.locale ?? undefined;
  if (query.archived === '1')
    return (
      <ArchivedScreen
        accounts={await listAccounts(database, accountId, book.id, { archived: true })}
        locale={locale}
      />
    );
  return (
    <AccountsScreen overview={await loadOverview(database, accountId, book)} locale={locale} />
  );
}
