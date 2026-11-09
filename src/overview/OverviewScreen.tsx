import Link from 'next/link';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { StatusToggle } from '../accounts/StatusToggle';
import { notIncludedLines } from '../money/convert';
import { formatMoney } from '../money/text';
import { describeEntry } from '../transactions/present';
import type { OverviewPage } from './overview';
import styles from './Overview.module.css';
import { UpcomingList } from '../recurring/UpcomingList';
import { SetupChecklist } from './SetupChecklist';

/**
 * Overview (DESIGN.md §14.3): this month's income, spending and saving, net worth, the budget rows closest to or over their budget, recent entries, and the
 * checklist of what is left to set up. Every figure is the budget screen's, the income page's or the accounts' own. Money owed is said in words, and what a
 * figure left out for want of a rate is said under it.
 */
export function OverviewScreen({ page, locale }: { page: OverviewPage; locale?: string }) {
  const { thisMonth: month, worth, close, recent } = page;
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  const saved = (amount: number | null, currency: string | null) =>
    amount === null || currency === null
      ? '—'
      : amount < 0
        ? `${money(-amount, currency)} short`
        : money(amount, currency);
  const netWorth = worth.netWorth.total;
  return (
    <PageContainer>
      <PageHeader title="Overview" description={`Where things stand in ${month.month}.`} />
      {page.reviewMonth ? (
        <p className={styles.note} role="status">
          <Link href={`/reports?month=${page.reviewMonth}`}>
            {page.reviewMonth} needs its review
          </Link>
        </p>
      ) : null}
      <SetupChecklist items={page.checklist} />
      {!page.hasAccounts ? (
        <EmptyState
          icon="house"
          heading="Nothing to show yet"
          description="Add an account, and then what you spend, and this fills in."
          action={<Link href="/accounts">Add an account</Link>}
        />
      ) : (
        <>
          <UpcomingList items={page.upcoming} locale={locale} />
          <section className={styles.section} aria-label="This month">
            <h2>This month</h2>
            <div className={styles.cards}>
              {month.base ? (
                <>
                  <div className={styles.card}>
                    <span>Income received</span>
                    <strong>{money(month.received?.amount ?? 0, month.base)}</strong>
                  </div>
                  <div className={styles.card}>
                    <span>Spent</span>
                    <strong>{money(month.spent?.amount ?? 0, month.base)}</strong>
                  </div>
                  <div className={styles.card}>
                    <span>Saved so far</span>
                    <strong>{saved(month.actualSaved, month.base)}</strong>
                  </div>
                  <div className={styles.card}>
                    <span>Planned to save</span>
                    <strong>{saved(month.projectedSaved, month.base)}</strong>
                  </div>
                </>
              ) : (
                <div className={styles.card}>
                  <span>This month</span>
                  <p className={styles.note}>
                    Choose a base currency in <Link href="/setup">setup</Link> to see income,
                    spending and saving added up.
                  </p>
                </div>
              )}
              <div className={styles.card}>
                <span>Net worth</span>
                <strong>
                  {netWorth
                    ? netWorth.amount < 0
                      ? `You owe ${money(-netWorth.amount, netWorth.currency)} more than you have`
                      : money(netWorth.amount, netWorth.currency)
                    : worth.netWorth.byCurrency
                        .map((each) => money(each.amount, each.currency))
                        .join(' + ') || '—'}
                </strong>
              </div>
            </div>
            {month.notIncluded.map((line) => (
              <p key={line} className={styles.note}>
                {line}
              </p>
            ))}
          </section>

          {page.jars.count > 0 ? (
            <section className={styles.section} aria-label="Jars">
              <h2>Jars</h2>
              <p>
                {page.jars.total
                  ? `${money(page.jars.total.amount, page.jars.total.currency)} set aside in ${page.jars.count} ${page.jars.count === 1 ? 'jar' : 'jars'}.`
                  : `${page.jars.count} ${page.jars.count === 1 ? 'jar' : 'jars'}.`}{' '}
                <Link href="/budget">Saving</Link>
              </p>
              {page.jars.total
                ? notIncludedLines(page.jars.total).map((line) => (
                    <p key={line} className={styles.note}>
                      Jars: {line}
                    </p>
                  ))
                : null}
              {page.jars.notes.map((note) => (
                <p key={note.text} className={styles.note}>
                  <Link href={note.href}>{note.text}</Link>
                </p>
              ))}
            </section>
          ) : null}

          <section className={styles.section} aria-label="Closest to budget">
            <h2>Closest to their budget</h2>
            {close.length === 0 ? (
              <p className={styles.note}>
                Nothing yet. <Link href="/budget">Set a budget</Link> and spending will show here as
                it nears it.
              </p>
            ) : (
              <ul className={styles.list}>
                {close.map(({ line, used }) => (
                  <li key={line.subcategory.id}>
                    <Link
                      className={styles.item}
                      href={`/budget?month=${month.month}&row=${line.subcategory.id}`}
                    >
                      <span>
                        {line.subcategory.name} · {line.category.name}
                      </span>
                      <span className={`${styles.amount} ${line.over > 0 ? styles.over : ''}`}>
                        {money(line.spent.amount, line.category.currency)} of{' '}
                        {money(line.budgeted ?? 0, line.category.currency)}
                        {line.over > 0
                          ? ` · over by ${money(line.over, line.category.currency)}`
                          : ` · ${Math.round(used * 100)}%`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-label="Recent transactions">
            <h2>Recent transactions</h2>
            {recent.length === 0 ? (
              <p className={styles.note}>
                Nothing has been entered yet. Add one with the Add button.
              </p>
            ) : (
              <ul className={styles.list}>
                {recent.map((entry) => {
                  const row = describeEntry(entry);
                  return (
                    <li key={entry.id} className={styles.item}>
                      <span>
                        {row.date} · {row.title}
                        <br />
                        <span className={styles.note}>
                          {row.category} · {row.account}
                        </span>
                      </span>
                      <span className={styles.amount}>
                        {money(row.amount, row.currency)}
                        {row.received
                          ? ` → ${money(row.received.amount, row.received.currency)}`
                          : ''}
                        <br />
                        <StatusToggle
                          id={row.id}
                          status={row.status}
                          label={`The entry of ${row.date}: ${row.title}`}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p>
              <Link href="/transactions">All transactions</Link>
            </p>
          </section>
        </>
      )}
    </PageContainer>
  );
}
