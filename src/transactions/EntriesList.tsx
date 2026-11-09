'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Checkbox, Select } from '@sovereignfs/ui';
import { EditEntryButton } from '../entries/EditEntryButton';
import { formatMoney } from '../money/text';
import styles from './Transactions.module.css';
import type { Row } from './present';

/**
 * The rows of the transactions list (DESIGN.md §6.9), with a box on each and, once any is ticked, what can be done to them: mark them cleared or pending, move
 * them to another subcategory, delete them (asked twice). An entry that cannot take a change is skipped by the server and the answer says how many. A row opens
 * in the add dialog to change or delete. With one account filtered, each row shows that account's balance after it.
 */
export function EntriesList({
  rows,
  subcategories,
  showBalance,
  locale,
}: {
  rows: readonly Row[];
  subcategories: readonly { id: string; label: string }[];
  showBalance: boolean;
  locale?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState('');
  const [sure, setSure] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [working, setWorking] = useState(false);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
    setSure(false);
  };

  async function act(body: Record<string, unknown>) {
    setWorking(true);
    setProblem('');
    setMessage('');
    try {
      const reply = await fetch('/api/transactions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, ids: [...picked] }),
      });
      if (!reply.ok) {
        const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
        setProblem(data.problems?.[0] ?? 'That could not be done. Nothing was changed.');
        return;
      }
      const { changed, skipped } = (await reply.json()) as { changed: number; skipped: number };
      setMessage(
        `${changed} ${changed === 1 ? 'entry' : 'entries'} changed${skipped > 0 ? `, ${skipped} left as ${skipped === 1 ? 'it was' : 'they were'}` : ''}.`,
      );
      setPicked(new Set());
      setSure(false);
      router.refresh();
    } catch {
      setProblem('That needs a connection. Nothing was changed.');
    } finally {
      setWorking(false);
    }
  }

  if (rows.length === 0) return <p className={styles.note}>No entries match.</p>;
  const all = rows.every((row) => picked.has(row.id));
  return (
    <div>
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      {message ? (
        <p role="status" className={styles.note}>
          {message}
        </p>
      ) : null}
      {picked.size > 0 ? (
        <div className={styles.bar} role="group" aria-label="What to do with the chosen entries">
          <span>{picked.size} chosen</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={working}
            onClick={() => void act({ action: 'status', status: 'cleared' })}
          >
            Mark cleared
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={working}
            onClick={() => void act({ action: 'status', status: 'pending' })}
          >
            Mark pending
          </Button>
          <Select
            aria-label="Move to a subcategory"
            size="sm"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Move to…</option>
            {subcategories.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            disabled={working || target === ''}
            onClick={() => void act({ action: 'recategorise', subcategoryId: target })}
          >
            Move
          </Button>
          {sure ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={working}
              onClick={() => void act({ action: 'delete' })}
            >
              Delete for good
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setSure(true)}>
              Delete…
            </Button>
          )}
        </div>
      ) : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <Checkbox
                label="Choose all on this page"
                checked={all}
                onChange={(on) => {
                  setPicked(on ? new Set(rows.map((row) => row.id)) : new Set());
                  setSure(false);
                }}
              />
            </th>
            <th>Date</th>
            <th>What</th>
            <th className={styles.hideNarrow}>Category</th>
            <th className={styles.hideNarrow}>Account</th>
            <th className={styles.money}>Amount</th>
            {showBalance ? <th className={styles.money}>Balance</th> : null}
            <th>
              <span className="sv-visually-hidden">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.status === 'pending' ? styles.pending : undefined}>
              <td>
                <Checkbox
                  label={`Choose the entry of ${row.date}: ${row.title}`}
                  checked={picked.has(row.id)}
                  onChange={(on) => toggle(row.id, on)}
                />
              </td>
              <td>{row.date}</td>
              <td>
                <span className={styles.title}>
                  {row.title}
                  <span>{row.status === 'pending' ? 'Pending' : 'Cleared'}</span>
                </span>
              </td>
              <td
                className={styles.hideNarrow}
                title={
                  row.parts
                    .map(
                      (part) => `${part.label} ${formatMoney(part.amount, part.currency, locale)}`,
                    )
                    .join(', ') || undefined
                }
              >
                {row.category}
              </td>
              <td className={styles.hideNarrow}>{row.account}</td>
              <td className={styles.money}>
                {formatMoney(row.amount, row.currency, locale)}
                {row.received
                  ? ` → ${formatMoney(row.received.amount, row.received.currency, locale)}`
                  : ''}
              </td>
              {showBalance ? (
                <td className={styles.money}>
                  {row.balanceAfter === null
                    ? ''
                    : formatMoney(row.balanceAfter, row.currency, locale)}
                </td>
              ) : null}
              <td>
                <EditEntryButton
                  id={row.id}
                  label={`Open the entry of ${row.date}: ${row.title}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
