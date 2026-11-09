import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { isMonth, monthOf, todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { MonthDetail, MonthList, YearDetail } from '@/src/reports/ReportsScreen';
import { loadYearReport } from '@/src/reports/year';
import { loadInsights } from '@/src/insights/load';
import { loadMonthList, loadMonthReport } from '@/src/reports/month';
import { loadNetWorthSeries } from '@/src/reports/net-worth';
import { reviewStatus, reviewedMonths } from '@/src/reports/review';

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
  const reviewed = await reviewedMonths(database, accountId, book.id);
  if (month)
    return (
      <MonthDetail
        report={await loadMonthReport(database, accountId, book, month)}
        status={reviewStatus(month, monthOf(todayIn(book.timeZone)), reviewed)}
        insights={await loadInsights(database, accountId, book, new Date(), { month })}
        locale={locale}
      />
    );
  return (
    <MonthList
      lines={await loadMonthList(database, accountId, book)}
      netWorth={await loadNetWorthSeries(database, accountId, book, 12)}
      statuses={Object.fromEntries([...reviewed].map((each) => [each, 'reviewed' as const]))}
      base={book.baseCurrency}
      locale={locale}
    />
  );
}
