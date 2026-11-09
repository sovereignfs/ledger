import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { isMonth } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { MonthDetail, MonthList } from '@/src/reports/ReportsScreen';
import { loadMonthList, loadMonthReport } from '@/src/reports/month';

export const metadata: Metadata = { title: 'Reports' };

/** Reports (DESIGN.md §11.1): the list of months, and `?month=YYYY-MM` for one month's report. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const database = await getDatabase();
  const query = await searchParams;
  const locale = book.locale ?? undefined;
  const month = typeof query.month === 'string' && isMonth(query.month) ? query.month : undefined;
  if (month)
    return (
      <MonthDetail
        report={await loadMonthReport(database, accountId, book, month)}
        locale={locale}
      />
    );
  return (
    <MonthList
      lines={await loadMonthList(database, accountId, book)}
      base={book.baseCurrency}
      locale={locale}
    />
  );
}
