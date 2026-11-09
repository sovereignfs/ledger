'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Input, Select } from '@sovereignfs/ui';
import type { PayeeRow } from '../ledger/payees';
import styles from './Payees.module.css';

/**
 * The payees (DESIGN.md §6.5): rename, archive and bring back, and merge one into another, which moves every entry to the one that is kept. A payee is
 * made by typing it in the add dialog; here they are looked after. A merge asks twice, since it cannot be undone.
 */
export function PayeesManager({
  payees,
  archived,
}: {
  payees: readonly PayeeRow[];
  archived: boolean;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [merging, setMerging] = useState<string | null>(null);
  const [into, setInto] = useState('');
  const [sure, setSure] = useState(false);
  const [working, setWorking] = useState(false);

  async function patch(id: string, body: unknown): Promise<boolean> {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(`/api/payees/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (reply.ok) {
        router.refresh();
        return true;
      }
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

  if (payees.length === 0)
    return (
      <p className={styles.note}>
        {archived
          ? 'No payee is archived.'
          : 'No payees yet. One is made the first time you type a name when you add an entry.'}
      </p>
    );

  return (
    <div className={styles.manager}>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={styles.problem}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      <ul className={styles.list}>
        {payees.map((payee) => (
          <li key={payee.id} className={styles.item}>
            {editing === payee.id ? (
              <form
                className={styles.inline}
                aria-label={`Rename ${payee.name}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void (async () => {
                    if (await patch(payee.id, { name: draft })) setEditing(null);
                  })();
                }}
              >
                <Input
                  aria-label="Name"
                  value={draft}
                  maxLength={80}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" size="sm" disabled={working || draft.trim() === ''}>
                  Save
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className={styles.line}>
                <Link href={`/payees/${payee.id}`} className={styles.name}>
                  {payee.name}
                  <span className={styles.count}>
                    {payee.entries} {payee.entries === 1 ? 'entry' : 'entries'}
                  </span>
                </Link>
                <span className={styles.controls}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Rename ${payee.name}`}
                    onClick={() => {
                      setEditing(payee.id);
                      setDraft(payee.name);
                    }}
                  >
                    Rename
                  </Button>
                  {!archived ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Merge ${payee.name} into another`}
                      onClick={() => {
                        setMerging(payee.id);
                        setInto('');
                        setSure(false);
                      }}
                    >
                      Merge
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${archived ? 'Bring back' : 'Archive'} ${payee.name}`}
                    disabled={working}
                    onClick={() => void patch(payee.id, { archived: !archived })}
                  >
                    {archived ? 'Bring back' : 'Archive'}
                  </Button>
                </span>
              </div>
            )}
            {merging === payee.id ? (
              <div className={styles.merge}>
                <Select
                  aria-label={`Merge ${payee.name} into`}
                  value={into}
                  onChange={(event) => {
                    setInto(event.target.value);
                    setSure(false);
                  }}
                >
                  <option value="">Choose the payee to keep</option>
                  {payees
                    .filter((other) => other.id !== payee.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </Select>
                {into !== '' && !sure ? (
                  <Button variant="secondary" size="sm" onClick={() => setSure(true)}>
                    Merge…
                  </Button>
                ) : null}
                {sure ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={working}
                    onClick={() =>
                      void (async () => {
                        if (await patch(payee.id, { mergeInto: into })) setMerging(null);
                      })()
                    }
                  >
                    Merge for good
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => setMerging(null)}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
