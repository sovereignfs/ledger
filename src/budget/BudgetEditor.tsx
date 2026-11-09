'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Select } from '@sovereignfs/ui';
import { MoneyInput } from '../ui/MoneyInput';
import styles from './Budget.module.css';

/**
 * Change what a subcategory is budgeted (DESIGN.md §7.3): **from this month or from next**, never an earlier one, so a past month is as it was. A budget that
 * is over is ended with a zero. The month "this" means is the book's own, worked out by the server.
 */
export function BudgetEditor({
  id,
  name,
  currency,
}: {
  id: string;
  name: string;
  currency: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(null);
  const [when, setWhen] = useState<'this' | 'next'>('this');
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState('');

  async function send(value: number) {
    setWorking(true);
    setProblems([]);
    setDone('');
    try {
      const reply = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'subcategory', id, amount: value, when }),
      });
      if (reply.ok) {
        setDone(
          value === 0
            ? `Ended from ${when === 'this' ? 'this month' : 'next month'}.`
            : `Set from ${when === 'this' ? 'this month' : 'next month'}.`,
        );
        setAmount(null);
        router.refresh();
        return;
      }
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(data.problems ?? ['That could not be done. Nothing was changed.']);
    } catch {
      setProblems(['That needs a connection. Nothing was changed.']);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form
      className={styles.editor}
      aria-label={`Budget for ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (amount === null) return setProblems(['Enter the amount to budget.']);
        void send(amount);
      }}
    >
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={styles.block}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      <MoneyInput
        aria-label={`Budgeted amount for ${name}`}
        currency={currency}
        valueCents={amount}
        onValueChange={setAmount}
      />
      <Select
        aria-label={`From, for ${name}`}
        size="sm"
        value={when}
        onChange={(event) => setWhen(event.target.value as 'this' | 'next')}
      >
        <option value="this">From this month</option>
        <option value="next">From next month</option>
      </Select>
      <Button type="submit" size="sm" disabled={working}>
        Set budget
      </Button>
      <Button variant="secondary" size="sm" disabled={working} onClick={() => void send(0)}>
        End budget
      </Button>
      {done ? (
        <span role="status" className={styles.note}>
          {done}
        </span>
      ) : null}
    </form>
  );
}
