import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { isMonth } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { MonthDetail, MonthList, YearDetail } from '@/src/reports/ReportsScreen';
import { loadYearReport } from '@/src/reports/year';
import { loadMonthList, loadMonthReport } from '@/src/reports/month';

export const metadata: Metadata = { title: 'Reports' };

/** Reports (DESIGN.md §11.1): the list of months, `?month=YYYY-MM` for one month's report and `?year=YYYY` for a year's. */
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
  const year =
    typeof query.year === 'string' && /^\d{4}$/.test(query.year) ? query.year : undefined;
  if (!month && year)
    return (
      <YearDetail report={await loadYearReport(database, accountId, book, year)} locale={locale} />
    );
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
