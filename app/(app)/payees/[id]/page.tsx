import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { getDatabase } from '@/src/db/boot';
import { getPayee, payeeMonths } from '@/src/ledger/payees';
import { formatMoney } from '@/src/money/text';
import styles from '@/src/payees/Payees.module.css';
import { PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Payee' };

/** One payee (DESIGN.md §6.5): its totals by month. Another person's is a 404, as one that never was. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { accountId, book } = await requireBook();
  const { id } = await params;
  const database = await getDatabase();
  const payee = await getPayee(database, accountId, book.id, id);
  if (!payee) notFound();
  const months = await payeeMonths(database, accountId, book.id, id);
  const locale = book.locale ?? undefined;
  return (
    <PageContainer>
      <PageHeader
        title={payee.name}
        description={`${payee.entries} ${payee.entries === 1 ? 'entry' : 'entries'}${payee.archivedAt ? ' · Archived' : ''}`}
      />
      <p>
        <Link href="/payees">All payees</Link>
      </p>
      <section aria-label="Totals by month">
        <h2>By month</h2>
        {months.length === 0 ? (
          <p className={styles.note}>Nothing has been spent or received here yet.</p>
        ) : (
          <table className={styles.months}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Currency</th>
                <th>Spent</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr key={`${month.month}-${month.currency}`}>
                  <td>{month.month}</td>
                  <td>{month.currency}</td>
                  <td>{formatMoney(month.spent, month.currency, locale)}</td>
                  <td>{formatMoney(month.received, month.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PageContainer>
  );
}
