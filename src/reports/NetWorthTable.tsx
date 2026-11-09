import { formatMoney } from '../money/text';
import type { NetWorthPoint } from './net-worth';
import styles from './Reports.module.css';

/**
 * Net worth at each month end (DESIGN.md §11.3), newest first: what you have, what you owe, and the difference, in the base currency. A table is how it is shown until the
 * charts of the design system exist (task 8.4), and stays beside them then. **What has no rate is left out and said**, with the currencies, never counted as nothing.
 */
export function NetWorthTable({
  points,
  base,
  locale,
  caption = 'Net worth by month end',
}: {
  points: readonly NetWorthPoint[];
  base: string;
  locale?: string;
  caption?: string;
}) {
  const money = (amount: number) => formatMoney(amount, base, locale);
  const left = [
    ...new Set(
      points.flatMap((point) => [
        ...point.assets.notIncluded.map((each) => each.currency),
        ...point.liabilities.notIncluded.map((each) => each.currency),
      ]),
    ),
  ].sort();
  const rows = [...points].reverse();
  return (
    <section className={styles.section} aria-label={caption}>
      <h2>{caption}</h2>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month end</th>
              <th>What you have</th>
              <th>What you owe</th>
              <th>Net worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => (
              <tr key={point.date}>
                <td>{point.date}</td>
                <td>{money(point.assets.amount)}</td>
                <td>{money(-point.liabilities.amount)}</td>
                <td>
                  {point.total < 0
                    ? `You owe ${money(-point.total)} more than you have`
                    : money(point.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {left.length > 0 ? (
        <p className={styles.note}>
          Amounts in {left.join(', ')} have no rate on some of these days and are not included.
        </p>
      ) : null}
    </section>
  );
}
