import Link from 'next/link';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import type { AccountRow, EntryOfAccount } from '../ledger/accounts';
import { ACCOUNT_KINDS } from '../ledger/account-types';
import { cardAvailable, cardUsed, loanProgress, sayBalance } from '../ledger/present';
import { formatMoney } from '../money/text';
import { EditEntryButton } from '../entries/EditEntryButton';
import { AccountActions } from './AccountActions';
import { ReconcileButton } from './ReconcileButton';
import { ValueButton } from './ValueButton';
import type { ListedEntry } from '../ledger/entry-list';
import { StatusToggle } from './StatusToggle';
import { InstalmentsSection, type Payer } from './InstalmentsSection';
import styles from './Accounts.module.css';
import { ENTRY_TYPE_LABEL } from './words';

/**
 * An account's page (DESIGN.md §6.1, §6.9): what it holds, said in words and never with a minus for what is owed; a card's limit used and left; a loan's
 * left to pay, paid and end; and the entries that touch it, newest first. An entry's amount is a movement and keeps its sign.
 */
export function AccountDetail({
  account,
  entries,
  values = [],
  today,
  locale,
  payers = [],
  instalments = null,
}: {
  account: AccountRow;
  entries: readonly EntryOfAccount[];
  /** The changes in value, for an investment or a property, newest first. */
  values?: readonly ListedEntry[];
  today: string;
  locale?: string;
  /** The accounts a loan's instalment may be paid from. */
  payers?: readonly Payer[];
  /** A loan's instalments, when it has them. */
  instalments?: { nextDate: string | null; mode: 'auto' | 'confirm' } | null;
}) {
  const money = (value: number) => formatMoney(value, account.currency, locale);
  const said = sayBalance(account.type, account.balance, account.currency, locale);
  const facts: { label: string; value: string }[] = [{ label: 'Balance', value: said.text }];
  if (account.type === 'credit_card' && account.creditLimit !== null) {
    facts.push(
      { label: 'Limit', value: money(account.creditLimit) },
      { label: 'Used', value: money(cardUsed(account.balance)) },
      { label: 'Available', value: money(cardAvailable(account.creditLimit, account.balance)) },
    );
  }
  if (account.loan) {
    const { left, paid } = loanProgress(account.loan.principal, account.balance);
    facts.push(
      { label: 'Left to pay', value: money(left) },
      { label: 'Paid so far', value: money(paid) },
      { label: 'Each instalment', value: money(account.loan.instalment) },
      { label: 'Ends', value: account.loan.endDate },
      { label: 'Lender', value: account.loan.lender },
    );
    if (account.loan.yearlyRate)
      facts.push({ label: 'Yearly interest', value: `${account.loan.yearlyRate}%` });
  }
  return (
    <PageContainer>
      <PageHeader
        title={account.name}
        description={`${ACCOUNT_KINDS[account.type].label}${account.institution ? ` · ${account.institution}` : ''} · ${account.currency}${account.archivedAt ? ' · Archived' : ''}`}
      />
      <p className={styles.note}>
        <Link href="/accounts">All accounts</Link>
      </p>
      <section className={styles.facts} aria-label="Summary">
        {facts.map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </section>
      <AccountActions
        id={account.id}
        name={account.name}
        institution={account.institution}
        archived={account.archivedAt !== null}
        deletable={account.deletable}
      />
      <div className={styles.actions}>
        {account.type === 'investment' || account.type === 'property' ? (
          <ValueButton
            id={account.id}
            currency={account.currency}
            balance={account.balance}
            today={today}
            locale={locale}
          />
        ) : null}
        <ReconcileButton
          id={account.id}
          type={account.type}
          currency={account.currency}
          today={today}
          locale={locale}
        />
      </div>
      {account.type === 'loan' && account.loan && account.archivedAt === null ? (
        <InstalmentsSection
          loanId={account.id}
          currency={account.currency}
          instalment={account.loan.instalment}
          today={today}
          locale={locale}
          payers={payers}
          existing={instalments}
        />
      ) : null}
      {values.length > 0 ? (
        <section aria-label="Value history">
          <h2>Value history</h2>
          <table className={styles.entries}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Change</th>
                <th>Worth after</th>
              </tr>
            </thead>
            <tbody>
              {values.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>
                    {formatMoney(
                      entry.lines.find((line) => line.account)?.amount ?? 0,
                      account.currency,
                      locale,
                    )}
                  </td>
                  <td>
                    {entry.balanceAfter === null
                      ? ''
                      : formatMoney(entry.balanceAfter, account.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section aria-label="Entries">
        <h2>Entries</h2>
        {entries.length === 0 ? (
          <p className={styles.note}>Nothing has been entered in this account yet.</p>
        ) : (
          <table className={styles.entries}>
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Status</th>
                <th>Amount</th>
                <th>
                  <span className={styles.visuallyHidden}>Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.txnId}-${entry.amount}`}>
                  <td>{entry.date}</td>
                  <td>
                    {ENTRY_TYPE_LABEL[entry.type] ?? entry.type}
                    {entry.parts > 1 ? ` · Split in ${entry.parts}` : ''}
                    {entry.payee ? ` · ${entry.payee}` : ''}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </td>
                  <td>
                    <StatusToggle
                      id={entry.txnId}
                      status={entry.status === 'cleared' ? 'cleared' : 'pending'}
                      label={`The entry of ${entry.date}`}
                    />
                  </td>
                  <td>{formatMoney(entry.amount, entry.currency, locale)}</td>
                  <td>
                    <EditEntryButton id={entry.txnId} label={`Edit the entry of ${entry.date}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PageContainer>
  );
}
