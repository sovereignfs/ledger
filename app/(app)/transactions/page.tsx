import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { loadEntryOptions } from '@/src/ledger/entries';
import { listEntries } from '@/src/ledger/entry-list';
import { EntriesList } from '@/src/transactions/EntriesList';
import { FilterBar } from '@/src/transactions/FilterBar';
import {
  filterCount,
  filterQuery,
  parseCursor,
  parseFilter,
  type EntryFilter,
} from '@/src/transactions/filter';
import { describeEntry } from '@/src/transactions/present';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Transactions' };

/** The category choice of the form says `c:<id>` or `s:<id>`; the address keeps `category` and `subcategory` apart. */
function normalise(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out = { ...params };
  const picked = Array.isArray(out.category) ? out.category[0] : out.category;
  if (picked?.startsWith('s:')) {
    out.subcategory = picked.slice(2);
    delete out.category;
  } else if (picked?.startsWith('c:')) out.category = picked.slice(2);
  return out;
}

/** Transactions (DESIGN.md §6.9): every entry, newest first and paged by date, narrowed by filters that live in the address. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const database = await getDatabase();
  const params = normalise(await searchParams);
  const filter: EntryFilter = parseFilter(params);
  const before = parseCursor(Array.isArray(params.before) ? params.before[0] : params.before);
  // One view has one address: what the form sent (empty fields, a category as `c:` or `s:`) is sent to the tidy one, and anything that is not a filter is dropped.
  const asked = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams))
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value])
      asked.append(name, each);
  const tidy = filterQuery(filter, before);
  if (asked.toString() !== tidy) redirect(tidy === '' ? '/transactions' : `/transactions?${tidy}`);
  const [page, options] = await Promise.all([
    listEntries(database, accountId, book.id, filter, before),
    loadEntryOptions(database, accountId, book, todayIn(book.timeZone)),
  ]);
  const rows = page.entries.map((entry) => describeEntry(entry, filter.account));
  const locale = book.locale ?? undefined;
  const subcategories = options.categories.flatMap((category) =>
    category.subcategories.map((sub) => ({ id: sub.id, label: `${sub.name} · ${category.name}` })),
  );
  const filtered = filterCount(filter) > 0;
  return (
    <PageContainer>
      <PageHeader title="Transactions" description="Every entry, findable." />
      <FilterBar filter={filter} options={options} />
      {rows.length === 0 && !filtered && !before ? (
        <EmptyState
          icon="list"
          heading="No transactions yet"
          description="Add one with the Add button: an expense, an income or a transfer."
        />
      ) : (
        <>
          <EntriesList
            rows={rows}
            subcategories={subcategories}
            showBalance={Boolean(filter.account)}
            locale={locale}
          />
          {page.next ? (
            <p>
              <Link href={`/transactions?${filterQuery(filter, page.next)}`}>Older entries</Link>
            </p>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
