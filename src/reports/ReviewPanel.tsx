'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import { addMonths } from '../dates';
import type { ReviewStatus } from './review';
import styles from './Reports.module.css';

/**
 * The review of a month (DESIGN.md §11.4): the month's report and two actions, **adjust budgets** (opens the budget of the next month, where a change writes history rows
 * from that month on) and **mark reviewed**, which can be undone. A month that is not over is in progress and is reviewed when it is.
 */
export function ReviewPanel({ month, status }: { month: string; status: ReviewStatus }) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  async function set(reviewed: boolean) {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, reviewed }),
      });
      if (reply.ok) return router.refresh();
      const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(body.problems ?? ['That could not be done. Try again.']);
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className={styles.section} aria-label="Review">
      <h2>Review</h2>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </Alert>
      ) : null}
      {status === 'in_progress' ? (
        <p className={styles.note}>
          This month is in progress. It can be reviewed once it is over.
        </p>
      ) : (
        <>
          <p>{status === 'reviewed' ? 'This month is reviewed.' : 'This month needs review.'}</p>
          <p className={styles.nav}>
            <Link href={`/budget?month=${addMonths(month, 1)}`}>
              Adjust budgets for {addMonths(month, 1)}
            </Link>
            {status === 'reviewed' ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={working}
                onClick={() => void set(false)}
              >
                Undo review
              </Button>
            ) : (
              <Button size="sm" disabled={working} onClick={() => void set(true)}>
                Mark reviewed
              </Button>
            )}
          </p>
        </>
      )}
    </section>
  );
}
