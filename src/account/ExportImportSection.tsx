'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import styles from './Account.module.css';

/**
 * Settings, Data, export and import (DESIGN.md §16): **Export** downloads the book as one file (every account, entry, budget, bill and jar, and the settings; not the rates, and
 * nothing to sign in with). **Import** reads a file back, **into an empty book only**, the whole file checked before anything is written; a file that is not right is refused with
 * sentences and writes nothing.
 */
export function ExportImportSection() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(file: File) {
    setBusy(true);
    setProblems([]);
    setDone('');
    try {
      const reply = await fetch('/api/import', { method: 'POST', body: await file.text() });
      if (reply.ok) {
        const body = (await reply.json()) as { rows: number };
        setDone(`Imported: ${body.rows} rows.`);
        router.refresh();
      } else {
        const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
        setProblems(body.problems ?? ['That could not be imported. Nothing was changed.']);
      }
    } catch {
      setProblems(['That needs a connection. Nothing was changed.']);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className={styles.group}>
      <h2>Export and import</h2>
      <p className={styles.hint}>
        Your whole book in one file: accounts, entries, budgets, bills, jars and settings. Not the
        exchange rates, and nothing you sign in with.
      </p>
      <div className={styles.row}>
        <a href="/api/export" download>
          <Button variant="secondary">Export your book</Button>
        </a>
      </div>
      <h2>Import</h2>
      <p className={styles.hint}>
        A file from Export goes into an empty book, such as a new account’s. It is checked whole
        first, and if anything is wrong nothing is imported.
      </p>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </Alert>
      ) : null}
      <div className={styles.row}>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label="File to import"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
          }}
        />
        {done ? (
          <span role="status" className={styles.hint}>
            {done}
          </span>
        ) : null}
      </div>
    </div>
  );
}
