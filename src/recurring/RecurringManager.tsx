'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button } from '@sovereignfs/ui';
import payees from '../payees/Payees.module.css';
import { formatMoney } from '../money/text';
import { amountOf } from './present';
import type { RecurringRow } from './recurring';
import { describeRule } from './rule';

const KINDS = { expense: 'Expense', income: 'Income', transfer: 'Transfer' } as const;

/**
 * The recurring entries (DESIGN.md §8): each with how often it repeats, when it is next due and whether it posts itself or waits to be confirmed, to switch
 * between the two or to end. What was posted stays. An ended entry is shown, not offered again.
 */
export function RecurringManager({
  rows,
  locale,
}: {
  rows: readonly RecurringRow[];
  locale: string | undefined;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);

  async function send(id: string, method: 'PATCH' | 'DELETE', body?: unknown) {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/recurring/${id}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (reply.ok) router.refresh();
      else {
        const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
        setProblems(data.problems ?? ['That could not be done. Try again.']);
      }
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
      setEnding(null);
    }
  }

  if (rows.length === 0)
    return (
      <p className={payees.note}>
        Nothing repeats yet. Open an entry from the transactions list and choose Repeat… to make a
        bill that posts itself.
      </p>
    );
  return (
    <div className={payees.manager}>
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
        {rows.map((row) => {
          const { amount, currency } = amountOf(row.template);
          const label = row.template.payee ?? KINDS[row.template.type];
          const active = row.endedAt === null;
          return (
            <li key={row.id} className={payees.item}>
              <div className={payees.line}>
                <div className={payees.name}>
                  <strong>{label}</strong>
                  <span>
                    {formatMoney(amount, currency, locale)} · {describeRule(row.rule)}
                  </span>
                  <span>{active && row.nextDate ? `Next ${row.nextDate}` : 'Ended'}</span>
                </div>
                <Badge>{row.mode === 'auto' ? 'Posts itself' : 'Asks first'}</Badge>
                {active ? (
                  <div className={payees.actions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={working}
                      aria-label={`${row.mode === 'auto' ? 'Ask first' : 'Post itself'}: ${label}`}
                      onClick={() =>
                        void send(row.id, 'PATCH', {
                          mode: row.mode === 'auto' ? 'confirm' : 'auto',
                        })
                      }
                    >
                      {row.mode === 'auto' ? 'Ask first' : 'Post itself'}
                    </Button>
                    {ending === row.id ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={working}
                        onClick={() => void send(row.id, 'DELETE')}
                      >
                        End for good
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`End ${label}`}
                        onClick={() => setEnding(row.id)}
                      >
                        End…
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
