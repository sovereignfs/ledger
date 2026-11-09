'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@sovereignfs/ui';
import { useEntryDialog } from '../entries/EntryProvider';
import type { ChecklistItem } from './overview';
import styles from './Overview.module.css';

const KEY = 'ledger:checklist-dismissed';

function stored(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The checklist of what is left to set up (DESIGN.md §15.3): more accounts, a card or a loan, a second source of income, bills, jars, people, in any order, each
 * ticked when the book has one. **Add works from it.** It can be put away, which this device remembers (a convenience of the viewer and not the book's), and
 * comes back from a link; when everything that can be done is, it is not shown at all.
 */
export function SetupChecklist({ items }: { items: readonly ChecklistItem[] }) {
  const { openAdd } = useEntryDialog();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(stored()), []);
  const remaining = items.filter((item) => !item.done && item.href !== null);
  if (remaining.length === 0) return null;

  const set = (value: boolean) => {
    setDismissed(value);
    try {
      if (value) window.localStorage.setItem(KEY, '1');
      else window.localStorage.removeItem(KEY);
    } catch {
      // Not remembered on this device; still put away until the page is read again.
    }
  };

  if (dismissed)
    return (
      <p className={styles.note}>
        <button type="button" onClick={() => set(false)}>
          Show the setup checklist
        </button>
      </p>
    );
  return (
    <section className={styles.checklist} aria-label="Setup checklist">
      <h2>Finish setting up</h2>
      <p className={styles.note}>In any order. Each is ticked when you have it.</p>
      <ul className={styles.steps}>
        {items.map((item) => (
          <li key={item.id} className={item.done ? styles.done : undefined}>
            {item.done ? '✓ ' : ''}
            {item.href && !item.done ? <Link href={item.href}>{item.label}</Link> : item.label}
            {item.note ? <span className={styles.note}> · {item.note}</span> : null}
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button onClick={openAdd}>Add an entry</Button>
        <Button variant="secondary" onClick={() => set(true)}>
          Put the checklist away
        </Button>
      </div>
    </section>
  );
}
