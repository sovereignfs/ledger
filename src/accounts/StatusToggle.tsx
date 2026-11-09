'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@sovereignfs/ui';

/**
 * An entry's status, as a button that turns it over (DESIGN.md §6.7): **pending** until it is seen on a statement, then **cleared**. It changes no figure; it
 * is an aid to reconciling and a filter of the list. A person can clear or un-clear one by hand, and reconciling clears every entry up to the statement's date.
 */
export function StatusToggle({
  id,
  status,
  label,
}: {
  id: string;
  status: 'pending' | 'cleared';
  label: string;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const next = status === 'pending' ? 'cleared' : 'pending';
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={working}
      aria-label={`${label}: ${status === 'pending' ? 'mark cleared' : 'mark pending'}`}
      onClick={() => {
        setWorking(true);
        void (async () => {
          try {
            const reply = await fetch('/api/transactions/bulk', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'status', ids: [id], status: next }),
            });
            if (reply.ok) router.refresh();
          } finally {
            setWorking(false);
          }
        })();
      }}
    >
      {status === 'pending' ? 'Pending' : 'Cleared'}
    </Button>
  );
}
