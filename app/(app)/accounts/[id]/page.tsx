import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { AccountDetail } from '@/src/accounts/AccountDetail';
import { monthOf, todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { entriesOf, getAccount, listAccounts } from '@/src/ledger/accounts';
import { listRecurring } from '@/src/recurring/recurring';
import { JAR_ACCOUNT_TYPES, accountFigures, earmarkedByAccount } from '@/src/jars/jars';
import { loadSaving } from '@/src/jars/saving';
import { listEntries } from '@/src/ledger/entry-list';

export const metadata: Metadata = { title: 'Account' };

/** One account (DESIGN.md §6.1): its balance in words, its entries, and what can be done to it. Another person's is a 404, as one that never was. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { accountId, book } = await requireBook();
  const { id } = await params;
  const database = await getDatabase();
  const account = await getAccount(database, accountId, book.id, id);
  if (!account) notFound();
  const entries = await entriesOf(database, accountId, book.id, id, { limit: 100 });
  const values =
    account.type === 'investment' || account.type === 'property'
      ? (
          await listEntries(
            database,
            accountId,
            book.id,
            { account: id, type: 'revaluation' },
            undefined,
            50,
          )
        ).entries
      : [];
  const loanTerms =
    account.type === 'loan'
      ? await Promise.all([
          listAccounts(database, accountId, book.id),
          listRecurring(database, accountId, book.id),
        ])
      : null;
  const payers = (loanTerms?.[0] ?? [])
    .filter(
      (each) =>
        each.currency === account.currency &&
        each.type !== 'loan' &&
        each.type !== 'credit_card' &&
        each.type !== 'investment' &&
        each.type !== 'property',
    )
    .map((each) => ({ id: each.id, name: each.name }));
  const instalments =
    (loanTerms?.[1] ?? []).find((each) => each.loanAccountId === id && each.endedAt === null) ??
    null;
  const canHoldJars = (JAR_ACCOUNT_TYPES as readonly string[]).includes(account.type);
  const [saving, earmarked] = canHoldJars
    ? await Promise.all([
        loadSaving(database, accountId, book.id, monthOf(todayIn(book.timeZone))),
        earmarkedByAccount(database, accountId, book.id),
      ])
    : [[], new Map<string, number>()];
  const jars = saving.filter((jar) => jar.accountId === id);
  const figures = canHoldJars ? accountFigures(account.balance, earmarked.get(id) ?? 0) : null;
  return (
    <AccountDetail
      account={account}
      entries={entries}
      values={values}
      today={todayIn(book.timeZone)}
      locale={book.locale ?? undefined}
      payers={payers}
      jars={canHoldJars ? jars : null}
      jarFigures={figures}
      instalments={instalments ? { nextDate: instalments.nextDate, mode: instalments.mode } : null}
    />
  );
}
