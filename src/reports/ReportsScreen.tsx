import Link from 'next/link';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { addMonths } from '../dates';
import { formatMoney } from '../money/text';
import type { MonthLine, MonthReport } from './month';
import styles from './Reports.module.css';

/**
 * The reports (DESIGN.md §11.1): the list of months, each with what was received, spent and saved and the current one "In progress", and a month's report
 * with its income, its spending by category and subcategory against the budget, the three savings figures, the summaries and what was left out for want of a
 * rate. **Every figure is the month report's own** (`src/reports/month.ts`); this adds none.
 */
export function MonthList({
  lines,
  base,
  locale,
}: {
  lines: readonly MonthLine[];
  base: string | null;
  locale?: string;
}) {
  const money = (amount: number | undefined) =>
    base && amount !== undefined ? formatMoney(amount, base, locale) : '—';
  return (
    <PageContainer>
      <PageHeader title="Reports" description="Looking back, month by month and year by year." />
      {lines.length === 0 ? (
        <p className={styles.note}>Nothing to report yet: reports begin with the first entry.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table} aria-label="Months">
            <thead>
              <tr>
                <th>Month</th>
                <th>Received</th>
                <th>Spent</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.month}>
                  <td>
                    <Link href={`/reports?month=${line.month}`}>{line.month}</Link>
                    {line.inProgress ? ' · In progress' : ''}
                  </td>
                  <td>{money(line.received?.amount)}</td>
                  <td>{money(line.spent?.amount)}</td>
                  <td>
                    {line.saved === null
                      ? '—'
                      : line.saved < 0
                        ? `${money(-line.saved)} short`
                        : money(line.saved)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}

export function MonthDetail({ report, locale }: { report: MonthReport; locale?: string }) {
  const { month, base } = report;
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  const inBase = (amount: number | null) =>
    base && amount !== null
      ? amount < 0
        ? `${money(-amount, base)} short`
        : money(amount, base)
      : '—';
  return (
    <PageContainer>
      <PageHeader
        title={`Report for ${month}`}
        description="Budgeted and spent, and what was saved."
      />
      <p className={styles.nav}>
        <Link href={`/reports?month=${addMonths(month, -1)}`}>Earlier</Link>
        <strong>{month}</strong>
        <Link href={`/reports?month=${addMonths(month, 1)}`}>Later</Link>
        {' · '}
        <Link href="/reports">All months</Link>
        {' · '}
        <Link href={`/budget?month=${month}`}>Budget</Link>
      </p>

      <section className={styles.section} aria-label="Income and saving">
        <h2>Income and saving</h2>
        <div className={styles.cards}>
          <div className={styles.card}>
            <span>Income received</span>
            <strong>{inBase(report.income.received?.amount ?? null)}</strong>
            <span className={styles.note}>
              of {inBase(report.income.budgeted?.amount ?? null)} budgeted
            </span>
          </div>
          <div className={styles.card}>
            <span>Spent</span>
            <strong>{inBase(report.budget.spent?.amount ?? null)}</strong>
            <span className={styles.note}>
              of {inBase(report.budget.budgeted?.amount ?? null)} budgeted
            </span>
          </div>
          <div className={styles.card}>
            <span>Planned to save</span>
            <strong>{inBase(report.savings.projected)}</strong>
          </div>
          <div className={styles.card}>
            <span>Saved</span>
            <strong>{inBase(report.savings.actual)}</strong>
          </div>
          <div className={styles.card}>
            <span>Saved after jars</span>
            <strong>{inBase(report.savings.afterJars)}</strong>
            <span className={styles.note}>
              {report.jars ? `${inBase(report.jars.amount)} earmarked in jars` : ''}
            </span>
          </div>
        </div>
        {report.notIncluded.map((line) => (
          <p key={line} className={styles.note}>
            {line}
          </p>
        ))}
      </section>

      <section className={styles.section} aria-label="Spending by category">
        <h2>Spending by category</h2>
        {report.categories.length === 0 ? (
          <p className={styles.note}>Nothing was budgeted or spent this month.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Budgeted</th>
                  <th>Spent</th>
                  <th>Over by</th>
                </tr>
              </thead>
              <tbody>
                {report.categories.flatMap((category) => [
                  <tr key={category.id}>
                    <td>
                      <strong>{category.name}</strong>
                    </td>
                    <td>{money(category.budgeted, category.currency)}</td>
                    <td>{money(category.spent, category.currency)}</td>
                    <td className={styles.over}>
                      {category.over > 0 ? money(category.over, category.currency) : ''}
                    </td>
                  </tr>,
                  ...category.rows.map((row) => (
                    <tr key={row.subcategory.id} className={styles.sub}>
                      <td>
                        <Link href={`/budget?month=${month}&row=${row.subcategory.id}`}>
                          {row.subcategory.name}
                        </Link>
                      </td>
                      <td>
                        {row.budgeted === null ? '—' : money(row.budgeted, category.currency)}
                      </td>
                      <td>{money(row.spent.amount, category.currency)}</td>
                      <td className={styles.over}>
                        {row.over > 0 ? money(row.over, category.currency) : ''}
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-label="Cards, people and loans">
        <h2>Cards, people and loans</h2>
        {report.cards.length + report.loans.length === 0 && !report.people ? (
          <p className={styles.note}>None.</p>
        ) : null}
        <ul>
          {report.cards.map((card) => (
            <li key={card.id}>
              {card.name}: {money(card.used, card.currency)} used
              {card.limit !== null ? ` of ${money(card.limit, card.currency)}` : ''}
            </li>
          ))}
          {report.loans.map((loan) => (
            <li key={loan.id}>
              {loan.name}: {money(loan.left, loan.currency)} left to pay,{' '}
              {money(loan.paid, loan.currency)} paid off this month
            </li>
          ))}
          {report.people &&
          (report.people.owedToYou.amount > 0 || report.people.youOwe.amount > 0) ? (
            <li>
              People: {base ? money(report.people.owedToYou.amount, base) : ''} owed to you,{' '}
              {base ? money(report.people.youOwe.amount, base) : ''} you owe
            </li>
          ) : null}
        </ul>
      </section>
    </PageContainer>
  );
}
