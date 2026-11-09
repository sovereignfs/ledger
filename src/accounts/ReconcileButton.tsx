'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import { ACCOUNT_KINDS, type AccountType } from '../ledger/account-types';
import { formatMoney } from '../money/text';
import { MoneyInput } from '../ui/MoneyInput';
import styles from './Accounts.module.css';

/**
 * Reconcile an account to its statement (DESIGN.md §6.4): the statement's balance and day, **what is still different, shown before anything is done**, and a
 * confirm that marks every entry up to the day cleared and records the difference as an adjustment. What is owed on a card or a loan is typed as an amount
 * owed, and made a balance here, once, as in the add-account dialog.
 */
export function ReconcileButton({
  id,
  type,
  currency,
  today,
  locale,
}: {
  id: string;
  type: AccountType;
  currency: string;
  today: string;
  locale?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [typed, setTyped] = useState<number | null>(null);
  const [owing, setOwing] = useState<'owes_me' | 'i_owe'>('owes_me');
  const [summary, setSummary] = useState<{ balance: number; pending: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState('');

  const side = ACCOUNT_KINDS[type].side;
  /** The statement's figure as a balance: what is owed is below nothing. */
  const balance =
    typed === null
      ? null
      : side === 'liability'
        ? -typed
        : type === 'person' && owing === 'i_owe'
          ? -typed
          : typed;

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const reply = await fetch(`/api/accounts/${id}/reconcile?date=${date}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (reply.ok)
          setSummary(
            ((await reply.json()) as { summary: { balance: number; pending: number } }).summary,
          );
        else setSummary(null);
      } catch {
        // The difference is not shown until it can be asked.
      }
    })();
    return () => controller.abort();
  }, [open, date, id]);

  const difference = balance !== null && summary ? balance - summary.balance : null;

  async function confirm() {
    if (balance === null) return setProblems(['Enter the balance on the statement.']);
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/accounts/${id}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, balance }),
      });
      const data = (await reply.json().catch(() => ({}))) as {
        adjustment?: number;
        cleared?: number;
        problems?: string[];
      };
      if (!reply.ok)
        return setProblems(data.problems ?? ['That could not be done. Nothing was changed.']);
      setOpen(false);
      setDone(
        data.adjustment
          ? `Reconciled: ${data.cleared ?? 0} cleared, and an adjustment of ${formatMoney(data.adjustment, currency, locale)} recorded.`
          : `Reconciled: ${data.cleared ?? 0} cleared, and nothing to adjust.`,
      );
      router.refresh();
    } catch {
      setProblems(['That needs a connection. Nothing was changed.']);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setDone('');
          setOpen(true);
        }}
      >
        Reconcile
      </Button>
      {done ? (
        <p role="status" className={styles.note}>
          {done}
        </p>
      ) : null}
      <Dialog open={open} onClose={() => setOpen(false)} title="Reconcile" aria-label="Reconcile">
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          {problems.length > 0 ? (
            <Alert variant="error">
              {problems.map((problem) => (
                <span key={problem} style={{ display: 'block' }}>
                  {problem}
                </span>
              ))}
            </Alert>
          ) : null}
          <FormField label="Statement date" required>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </FormField>
          {type === 'person' ? (
            <FormField label="Who owes whom">
              {(field) => (
                <Select
                  {...field}
                  value={owing}
                  onChange={(event) => setOwing(event.target.value as 'owes_me' | 'i_owe')}
                >
                  <option value="owes_me">They owe me</option>
                  <option value="i_owe">I owe them</option>
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField
            label={side === 'liability' ? 'Owed on the statement' : 'Balance on the statement'}
            required
          >
            {(field) => (
              <MoneyInput
                {...field}
                currency={currency}
                valueCents={typed}
                onValueChange={setTyped}
              />
            )}
          </FormField>
          {summary ? (
            <p className={styles.note} role="status">
              Your entries to that day come to {formatMoney(summary.balance, currency, locale)}
              {summary.pending > 0
                ? `, and ${summary.pending} of them ${summary.pending === 1 ? 'is' : 'are'} pending: they will be marked cleared`
                : ''}
              .
              {difference === null
                ? ''
                : difference === 0
                  ? ' That matches the statement: nothing will be adjusted.'
                  : ` An adjustment of ${formatMoney(difference, currency, locale)} will be recorded.`}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button type="submit" disabled={working || balance === null}>
              {working ? 'Reconciling…' : 'Reconcile'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
