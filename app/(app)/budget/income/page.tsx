import type { Metadata } from 'next';
import Link from 'next/link';
import { requireBook } from '@/src/access/page';
import { IncomeManager } from '@/src/budget/IncomeManager';
import { loadIncome } from '@/src/budget/income';
import { notIncludedLines } from '@/src/money/convert';
import { formatMoney } from '@/src/money/text';
import styles from '@/src/budget/Categories.module.css';
import { addMonths, isMonth, monthOf, todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Income' };

/** Income (DESIGN.md §7.4): what is budgeted and what arrived, apart, for a month, converted to the base currency, with a missing rate said. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const asked = (await searchParams).month;
  const now = monthOf(todayIn(book.timeZone));
  const month = typeof asked === 'string' && isMonth(asked) ? asked : now;
  const figures = await loadIncome(await getDatabase(), accountId, book, month);
  const locale = book.locale ?? undefined;
  return (
    <PageContainer>
      <PageHeader title="Income" description="What is budgeted, and what arrived." />
      <p>
        <Link href={`/budget/income?month=${addMonths(month, -1)}`}>Earlier</Link>
        {' · '}
        <strong>{month}</strong>
        {' · '}
        <Link href={`/budget/income?month=${addMonths(month, 1)}`}>Later</Link>
        {' · '}
        <Link href="/budget">Budget</Link>
      </p>
      <section aria-label={`Income in ${month}`} className={styles.category}>
        {figures.base && figures.budgeted && figures.received ? (
          <>
            <p>
              Budgeted <strong>{formatMoney(figures.budgeted.amount, figures.base, locale)}</strong>{' '}
              · Received{' '}
              <strong>{formatMoney(figures.received.amount, figures.base, locale)}</strong>
            </p>
            {[
              ...notIncludedLines(figures.budgeted).map((line) => `Budgeted: ${line}`),
              ...notIncludedLines(figures.received).map((line) => `Received: ${line}`),
            ].map((line) => (
              <p key={line} className={styles.note}>
                {line}
              </p>
            ))}
          </>
        ) : (
          <p className={styles.note}>
            Budgeted{' '}
            {figures.byCurrency.budgeted
              .map((each) => formatMoney(each.amount, each.currency, locale))
              .join(' + ') || formatMoney(0, 'USD', locale)}{' '}
            · Received{' '}
            {figures.byCurrency.received
              .map((each) => formatMoney(each.amount, each.currency, locale))
              .join(' + ') || formatMoney(0, 'USD', locale)}
            . Each currency is added on its own until a base currency is chosen.
          </p>
        )}
      </section>
      <IncomeManager rows={figures.rows} baseCurrency={book.baseCurrency} locale={locale} />
    </PageContainer>
  );
}
