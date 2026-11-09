'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Checkbox } from '@sovereignfs/ui';
import styles from './Account.module.css';

/**
 * Settings, Notifications (DESIGN.md §11.5, §15.1): whether the monthly recap is sent. It is a summary of last month on the 1st, in the book's time zone, and it is
 * sent where the app can send it: through the bell and the email of a Sovereign instance, or through the app's own mail server, and nowhere if neither is set up. This
 * says whether it is wanted.
 */
export function NotificationsSection({ recap }: { recap: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(recap);
  const [problems, setProblems] = useState<string[]>([]);

  async function set(next: boolean) {
    setOn(next);
    setProblems([]);
    try {
      const reply = await fetch('/api/book', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recap: next }),
      });
      if (reply.ok) return router.refresh();
      setOn(!next);
      const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(body.problems ?? ['That could not be saved.']);
    } catch {
      setOn(!next);
      setProblems(['That needs a connection.']);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Notifications</h2>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </Alert>
      ) : null}
      <Checkbox
        label="Send me a recap of each month"
        checked={on}
        onChange={(next) => void set(next)}
      />
      <p className={styles.hint}>
        A summary of last month, on the 1st. It is sent where this server can send it, and not at
        all if no mail or notification service is set up.
      </p>
    </div>
  );
}
