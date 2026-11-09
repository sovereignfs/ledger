'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import { formatMoney } from '../money/text';
import { MoneyInput } from '../ui/MoneyInput';
import styles from './Accounts.module.css';

/**
 * Give an investment or a property a value (DESIGN.md §6.6): what it is worth on a day. It is valued, not traded, so the difference is recorded as a change
 * in value: **not income and not spending**. The dialog says what the change will be before anything is recorded.
 */
export function ValueButton({
  id,
  currency,
  balance,
  today,
  locale,
}: {
  id: string;
  currency: string;
  /** What the account is worth now, to say what the change would be when the day is today or later. */
  balance: number;
  today: string;
  locale?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState<number | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState('');

  async function confirm() {
    if (value === null) return setProblems(['Enter what it is worth.']);
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/accounts/${id}/value`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, value }),
      });
      const data = (await reply.json().catch(() => ({}))) as {
        change?: number;
        problems?: string[];
      };
      if (!reply.ok)
        return setProblems(data.problems ?? ['That could not be done. Nothing was changed.']);
      setOpen(false);
      setDone(
        data.change
          ? `Valued at ${formatMoney(value, currency, locale)}: a change of ${formatMoney(data.change, currency, locale)} recorded.`
          : `Valued at ${formatMoney(value, currency, locale)}: it was worth that already.`,
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
        Update value
      </Button>
      {done ? (
        <p role="status" className={styles.note}>
          {done}
        </p>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Update value"
        aria-label="Update value"
      >
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
          <FormField label="Worth" required>
            {(field) => (
              <MoneyInput
                {...field}
                currency={currency}
                valueCents={value}
                onValueChange={setValue}
              />
            )}
          </FormField>
          <FormField label="On" required>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </FormField>
          {value !== null && date >= today ? (
            <p className={styles.note} role="status">
              It is worth {formatMoney(balance, currency, locale)} now: a change of{' '}
              {formatMoney(value - balance, currency, locale)} will be recorded, which is neither
              income nor spending.
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button type="submit" disabled={working || value === null}>
              {working ? 'Saving…' : 'Update value'}
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
