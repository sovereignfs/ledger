import Link from 'next/link';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { ACCOUNT_KINDS } from '../ledger/account-types';
import { sayBalance } from '../ledger/present';
import { notIncludedLines } from '../money/convert';
import { formatMoney } from '../money/text';
import styles from './Accounts.module.css';
import { NewAccountButton } from './NewAccountButton';
import type { AccountRow } from '../ledger/accounts';
import type { Overview } from './overview';

/** Net worth, said: never with a minus for owing more than one has, but in words. */
function worthText(amount: number, currency: string, locale?: string): string {
  return amount < 0
    ? `You owe ${formatMoney(-amount, currency, locale)} more than you have`
    : formatMoney(amount, currency, locale);
}

/** A list of accounts, each a link to its page, with its balance said in words. */
function AccountList({ accounts, locale }: { accounts: readonly AccountRow[]; locale?: string }) {
  return (
    <ul className={styles.list}>
      {accounts.map((account) => {
        const said = sayBalance(account.type, account.balance, account.currency, locale);
        return (
          <li key={account.id}>
            <Link className={styles.row} href={`/accounts/${account.id}`}>
              <span className={styles.name}>
                <strong>{account.name}</strong>
                <span>
                  {ACCOUNT_KINDS[account.type].label}
                  {account.institution ? ` · ${account.institution}` : ''}
                  {` · ${account.currency}`}
                </span>
              </span>
              <span className={`${styles.amount} ${said.tone === 'owed' ? styles.owed : ''}`}>
                {said.text}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The accounts that were archived: out of the lists and the pickers, in the past totals, and brought back from their own page. */
export function ArchivedScreen({
  accounts,
  locale,
}: {
  accounts: readonly AccountRow[];
  locale?: string;
}) {
  return (
    <PageContainer>
      <PageHeader
        title="Archived accounts"
        description="Out of the way, and still in past totals."
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon="credit-card"
          heading="Nothing archived"
          description="Archive an account from its page to keep it out of the way."
        />
      ) : (
        <AccountList accounts={accounts} locale={locale} />
      )}
      <p className={styles.note}>
        <Link href="/accounts">Back to accounts</Link>
      </p>
    </PageContainer>
  );
}

/** The Accounts screen (DESIGN.md §14.3): net worth, and the accounts in what you have, what you owe and people. */
export function AccountsScreen({ overview, locale }: { overview: Overview; locale?: string }) {
  const { groups, netWorth: worth, baseCurrency, today, archived } = overview;
  const empty = groups.length === 0;
  return (
    <PageContainer>
      <PageHeader
        title="Accounts"
        description="What you have, what you owe, what you are worth."
        action={<NewAccountButton defaultCurrency={baseCurrency ?? 'USD'} today={today} />}
      />
      {empty ? (
        <EmptyState
          icon="credit-card"
          heading="No accounts yet"
          description="Add the places your money is kept, and what you owe, to see what you are worth."
        />
      ) : (
        <>
          <section className={styles.worth} aria-label="Net worth">
            <p className={styles.worthLabel}>Net worth</p>
            {worth.total ? (
              <>
                <p className={styles.worthAmount}>
                  {worthText(worth.total.amount, worth.total.currency, locale)}
                </p>
                {notIncludedLines(worth.total).map((line) => (
                  <p key={line} className={styles.note}>
                    {line}
                  </p>
                ))}
              </>
            ) : (
              <>
                {worth.byCurrency.map((each) => (
                  <p key={each.currency} className={styles.worthAmount}>
                    {worthText(each.amount, each.currency, locale)}
                  </p>
                ))}
                <p className={styles.note}>
                  Each currency is added on its own until a base currency is chosen.
                </p>
              </>
            )}
          </section>
          <div className={styles.groups}>
            {groups.map((group) => (
              <section key={group.id} className={styles.group} aria-label={group.title}>
                <h2>{group.title}</h2>
                <AccountList accounts={group.accounts} locale={locale} />
              </section>
            ))}
          </div>
        </>
      )}
      {archived > 0 ? (
        <p className={styles.note}>
          <Link href="/accounts?archived=1">
            {archived} archived account{archived === 1 ? '' : 's'}
          </Link>
        </p>
      ) : null}
    </PageContainer>
  );
}
