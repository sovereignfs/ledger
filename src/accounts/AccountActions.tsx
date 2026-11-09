'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, ConfirmDialog, FormField, Input } from '@sovereignfs/ui';
import styles from './Accounts.module.css';

/**
 * What can be done to an account from its page (DESIGN.md §6.1): rename it and name its institution, archive it or bring it back, and delete it **only while
 * it has nothing but its opening balance**: with entries, archiving is what is offered, and the page says why. The currency and the kind are not here, since
 * a change would re-price the account's history.
 */
export function AccountActions({
  id,
  name,
  institution,
  archived,
  deletable,
}: {
  id: string;
  name: string;
  institution: string | null;
  archived: boolean;
  deletable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(name);
  const [newInstitution, setNewInstitution] = useState(institution ?? '');
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  async function send(method: 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/accounts/${id}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (reply.ok) return true;
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(data.problems ?? ['That could not be done. Try again.']);
      return false;
    } catch {
      setProblems(['That needs a connection.']);
      return false;
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} style={{ display: 'block' }}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      {editing ? (
        <form
          className={styles.form}
          aria-label="Rename account"
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              const body = {
                name: newName,
                institution: newInstitution.trim() === '' ? null : newInstitution,
              };
              if (await send('PATCH', body)) {
                setEditing(false);
                router.refresh();
              }
            })();
          }}
        >
          <FormField label="Name" required>
            {(field) => (
              <Input
                {...field}
                value={newName}
                maxLength={80}
                onChange={(event) => setNewName(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Institution">
            {(field) => (
              <Input
                {...field}
                value={newInstitution}
                maxLength={80}
                onChange={(event) => setNewInstitution(event.target.value)}
              />
            )}
          </FormField>
          <div className={styles.actions}>
            <Button type="submit" disabled={working || newName.trim() === ''}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button
            variant="secondary"
            disabled={working}
            onClick={() =>
              void (async () => {
                if (await send('PATCH', { archived: !archived })) router.refresh();
              })()
            }
          >
            {archived ? 'Bring back' : 'Archive'}
          </Button>
          {deletable ? (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Delete…
            </Button>
          ) : null}
        </div>
      )}
      {!deletable ? (
        <p className={styles.note}>
          This account has entries, so it cannot be deleted. Archiving keeps it out of the way and
          in past totals.
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this account?"
        message="It has nothing in it but the balance it was opened with, and that goes with it. This cannot be undone."
        confirmLabel="Delete account"
        destructive
        pending={working}
        onConfirm={() =>
          void (async () => {
            if (await send('DELETE')) {
              setConfirming(false);
              router.push('/accounts');
              router.refresh();
            } else setConfirming(false);
          })()
        }
      />
    </div>
  );
}
