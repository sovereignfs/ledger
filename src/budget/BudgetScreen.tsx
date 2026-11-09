import Link from 'next/link';
import { EmptyState, PageContainer, PageHeader, Progress } from '@sovereignfs/ui';
import { addMonths } from '../dates';
import type { BudgetRow as HistoryRow } from './budget-for';
import { notIncludedLines } from '../money/convert';
import { formatMoney } from '../money/text';
import type { Row } from '../transactions/present';
import { BudgetEditor } from './BudgetEditor';
import type { BudgetFigures, BudgetLine } from './screen';
import styles from './Budget.module.css';

/** What a selected row shows (DESIGN.md §7.2): its entries this month, and the history of what it was budgeted. */
export interface Selected {
  readonly line: BudgetLine;
  readonly entries: readonly Row[];
  readonly history: readonly HistoryRow[];
}

const percent = (spent: number, budgeted: number | null): number =>
  budgeted === null || budgeted <= 0
    ? 0
    : Math.max(0, Math.min(100, Math.round((spent / budgeted) * 100)));

/**
 * The Budget screen (DESIGN.md §7.2, §14.3): for a month, **Bills**, **Spending** and **Saving**, each row its budgeted amount, what was spent, and a bar; being
 * over is said in words and not by colour alone. Totals are in the base currency with what was left out for want of a rate said, or one total for each currency
 * while the book has no base currency. A row opens (`?row=`) to its entries this month and its history, and is where its amount is changed.
 */
export function BudgetScreen({
  figures,
  selected,
  locale,
}: {
  figures: BudgetFigures;
  selected: Selected | undefined;
  locale?: string;
}) {
  const { month, base } = figures;
  const empty = figures.groups.every((group) => group.rows.length === 0);
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  return (
    <PageContainer>
      <PageHeader title="Budget" description="Budgeted and spent, month by month." />
      <p className={styles.nav}>
        <Link href={`/budget?month=${addMonths(month, -1)}`}>Earlier</Link>
        <strong>{month}</strong>
        <Link href={`/budget?month=${addMonths(month, 1)}`}>Later</Link>
        {' · '}
        <Link href="/budget/categories">Categories</Link>
        {' · '}
        <Link href="/budget/income">Income</Link>
        {' · '}
        <Link href="/budget/bills">Bills</Link>
        {' · '}
        <Link href="/payees">Payees</Link>
      </p>
      {empty ? (
        <EmptyState
          icon="sliders-horizontal"
          heading="No categories yet"
          description="Make a category and its subcategories, and a budget can be set for each."
          action={<Link href="/budget/categories">Make categories</Link>}
        />
      ) : (
        <>
          <section className={styles.totals} aria-label={`Totals for ${month}`}>
            {base && figures.budgeted && figures.spent ? (
              <>
                <p className={styles.big}>
                  Spent {money(figures.spent.amount, base)} of{' '}
                  {money(figures.budgeted.amount, base)} budgeted
                </p>
                {[
                  ...notIncludedLines(figures.budgeted).map((line) => `Budgeted: ${line}`),
                  ...notIncludedLines(figures.spent).map((line) => `Spent: ${line}`),
                ].map((line) => (
                  <p key={line} className={styles.note}>
                    {line}
                  </p>
                ))}
              </>
            ) : (
              <p className={styles.note}>
                Spent{' '}
                {figures.byCurrency.spent
                  .map((each) => money(each.amount, each.currency))
                  .join(' + ') || money(0, 'USD')}{' '}
                of{' '}
                {figures.byCurrency.budgeted
                  .map((each) => money(each.amount, each.currency))
                  .join(' + ') || money(0, 'USD')}{' '}
                budgeted. Each currency is added on its own until a base currency is chosen.
              </p>
            )}
          </section>
          {figures.groups.map((group) => (
            <section key={group.id} className={styles.group} aria-label={group.title}>
              <h2>{group.title}</h2>
              {group.rows.length === 0 ? (
                <p className={styles.note}>
                  {group.id === 'saving'
                    ? 'Jars and their monthly contributions will be here.'
                    : group.id === 'bills'
                      ? 'Subcategories budgeted by their recurring bills will be here.'
                      : 'Nothing here yet.'}
                </p>
              ) : (
                <ul className={styles.rows}>
                  {group.rows.map((line) => (
                    <li key={line.subcategory.id}>
                      <Link
                        className={styles.row}
                        href={`/budget?month=${month}&row=${line.subcategory.id}`}
                        aria-current={selected?.line.subcategory.id === line.subcategory.id}
                      >
                        <span className={styles.name}>
                          <strong>
                            {line.subcategory.name}
                            {line.subcategory.archived ? ' (archived)' : ''}
                          </strong>
                          <span>
                            {line.category.name} · {line.category.currency}
                          </span>
                        </span>
                        <span className={styles.figures}>
                          {money(line.spent.amount, line.category.currency)} of{' '}
                          {line.budgeted === null
                            ? 'no budget'
                            : money(line.budgeted, line.category.currency)}
                          {line.over > 0 ? (
                            <>
                              <br />
                              <span className={styles.over}>
                                Over by {money(line.over, line.category.currency)}
                              </span>
                            </>
                          ) : null}
                        </span>
                        <span className={styles.bar}>
                          <Progress
                            value={percent(line.spent.amount, line.budgeted)}
                            label={`${line.subcategory.name}: ${money(line.spent.amount, line.category.currency)} spent`}
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
      {selected ? (
        <section
          className={styles.detail}
          aria-label={`${selected.line.subcategory.name} in ${month}`}
        >
          <h2>
            {selected.line.subcategory.name} · {selected.line.category.name}
          </h2>
          {selected.line.spent.notIncluded.length > 0
            ? notIncludedLines(selected.line.spent).map((line) => (
                <p key={line} className={styles.note}>
                  Spent: {line}
                </p>
              ))
            : null}
          <h3>Budget</h3>
          {selected.line.subcategory.budgetSource === 'bills' ? (
            <p className={styles.note}>
              This is budgeted by its recurring bills: what they come to in a month. Change them on{' '}
              <Link href="/budget/bills">Bills</Link>, or budget it by hand from Categories.
            </p>
          ) : (
            <BudgetEditor
              id={selected.line.subcategory.id}
              name={selected.line.subcategory.name}
              currency={selected.line.category.currency}
            />
          )}
          <h3>History</h3>
          {selected.history.length === 0 ? (
            <p className={styles.note}>No budget has been set.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>Budgeted</th>
                </tr>
              </thead>
              <tbody>
                {selected.history.map((row) => (
                  <tr key={row.fromMonth}>
                    <td>{row.fromMonth}</td>
                    <td>
                      {row.amount === 0
                        ? 'Ended'
                        : money(row.amount, selected.line.category.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Entries this month</h3>
          {selected.entries.length === 0 ? (
            <p className={styles.note}>Nothing has been spent here this month.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {selected.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.date}</td>
                    <td>{entry.title}</td>
                    <td>{money(entry.amount, entry.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>
            <Link
              href={`/transactions?subcategory=${selected.line.subcategory.id}&from=${month}-01&to=${month}-31`}
            >
              All its entries
            </Link>
          </p>
        </section>
      ) : null}
    </PageContainer>
  );
}
