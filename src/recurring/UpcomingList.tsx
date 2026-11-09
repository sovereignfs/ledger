'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import payees from '../payees/Payees.module.css';
import { formatMoney } from '../money/text';
import { MoneyInput } from '../ui/MoneyInput';
import { amountOf, withAmount } from './present';
import type { Upcoming } from './recurring';

const KINDS = { expense: 'Expense', income: 'Income', transfer: 'Transfer' } as const;
const WHEN = { overdue: 'Overdue', due: 'Due today', coming: 'Coming' } as const;

/**
 * What waits to be confirmed (DESIGN.md §8.2): each bill that asks first, with the amount it was set up with. The person posts it as it is, posts it with the
 * amount it came to, or skips this one. Overdue ones stay until handled. An entry that is more than two lines is posted as it is and edited afterwards.
 */
export function UpcomingList({
  items,
  locale,
}: {
  items: readonly Upcoming[];
  locale: string | undefined;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});

  if (items.length === 0) return null;

  async function send(item: Upcoming, what: 'post' | 'skip', amount?: number) {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/recurring/${item.id}/${what}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: item.date, ...(amount === undefined ? {} : { amount }) }),
      });
      if (reply.ok || reply.status === 409) {
        if (reply.status === 409) {
          const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
          setProblems(data.problems ?? []);
        }
        router.refresh();
      } else {
        const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
        setProblems(data.problems ?? ['That could not be done. Try again.']);
      }
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-label="Upcoming" className={payees.manager}>
      <h2>Upcoming</h2>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={payees.problem}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      <ul className={payees.list}>
        {items.map((item) => {
          const { amount, currency } = amountOf(item.template);
          const label = item.template.payee ?? KINDS[item.template.type];
          const editable = withAmount(item.template, amount) !== undefined;
          const chosen = amounts[item.id] ?? amount;
          return (
            <li key={item.id} className={payees.item}>
              <div className={payees.line}>
                <div className={payees.name}>
                  <strong>{label}</strong>
                  <span>
                    {WHEN[item.state]} · {item.date} · {formatMoney(amount, currency, locale)}
                  </span>
                </div>
                <div className={payees.actions}>
                  {editable ? (
                    <MoneyInput
                      aria-label={`Amount for ${label}`}
                      currency={currency}
                      valueCents={chosen}
                      onValueChange={(next) => setAmounts((now) => ({ ...now, [item.id]: next }))}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    disabled={working || (editable && !chosen)}
                    aria-label={`Post ${label}`}
                    onClick={() =>
                      void send(
                        item,
                        'post',
                        editable && chosen !== amount ? (chosen ?? undefined) : undefined,
                      )
                    }
                  >
                    Post
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    aria-label={`Skip ${label}`}
                    onClick={() => void send(item, 'skip')}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
