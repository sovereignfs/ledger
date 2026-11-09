'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Checkbox, FormField, Input, Select } from '@sovereignfs/ui';
import { formatMoney } from '../money/text';
import styles from './Accounts.module.css';

export interface Payer {
  readonly id: string;
  readonly name: string;
}

/**
 * A loan's instalments (DESIGN.md §8.3): offered when the loan has none, as a recurring entry from an account on a first day and then every month, posting
 * itself or asking first; once made, said in a line with a link to the Bills page. Each instalment is split into interest and principal when it is posted.
 */
export function InstalmentsSection({
  loanId,
  currency,
  instalment,
  today,
  locale,
  payers,
  existing,
}: {
  loanId: string;
  currency: string;
  instalment: number;
  today: string;
  locale: string | undefined;
  payers: readonly Payer[];
  existing: { nextDate: string | null; mode: 'auto' | 'confirm' } | null;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(payers[0]?.id ?? '');
  const [first, setFirst] = useState(today);
  const [ask, setAsk] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  async function make() {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/accounts/${loanId}/instalments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, firstDate: first, mode: ask ? 'confirm' : 'auto' }),
      });
      if (reply.ok) return router.refresh();
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(data.problems ?? ['That could not be done. Try again.']);
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
    }
  }

  if (existing)
    return (
      <section aria-label="Instalments">
        <h2>Instalments</h2>
        <p className={styles.note}>
          {formatMoney(instalment, currency, locale)} a month,{' '}
          {existing.mode === 'auto' ? 'posted by itself' : 'asking you first'}
          {existing.nextDate ? `, next on ${existing.nextDate}` : ', ended'}.{' '}
          <Link href="/budget/bills">Bills</Link>
        </p>
      </section>
    );
  if (payers.length === 0) return null;
  return (
    <section aria-label="Instalments">
      <h2>Instalments</h2>
      <p className={styles.note}>
        Pay {formatMoney(instalment, currency, locale)} a month from an account. Each is split into
        interest and what comes off the loan, and the last is what is left.
      </p>
      <form
        className={styles.instalments}
        aria-label="Pay the instalments"
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        {problems.length > 0 ? (
          <Alert variant="error">
            {problems.map((problem) => (
              <span key={problem}>{problem}</span>
            ))}
          </Alert>
        ) : null}
        <FormField label="Pay from" required>
          {(field) => (
            <Select {...field} value={from} onChange={(event) => setFrom(event.target.value)}>
              {payers.map((payer) => (
                <option key={payer.id} value={payer.id}>
                  {payer.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="First instalment" required hint="Then the same day each month.">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={first}
              onChange={(event) => setFirst(event.target.value)}
            />
          )}
        </FormField>
        <Checkbox label="Ask me before each is posted" checked={ask} onChange={setAsk} />
        <div>
          <Button type="submit" disabled={working || from === ''}>
            Pay the instalments
          </Button>
        </div>
      </form>
    </section>
  );
}
