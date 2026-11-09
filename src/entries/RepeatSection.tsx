'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, FormField, Input, Select } from '@sovereignfs/ui';
import styles from './Entry.module.css';

/**
 * "Repeat…" on an entry that was written (DESIGN.md §8.2): how often, whether it posts itself or waits to be confirmed, and when it stops. The entry is the
 * first of the series and the next is the one after it. A mistake comes back as sentences from the server, as in the rest of the dialog.
 */
export function RepeatSection({ entryId, onMade }: { entryId: string; onMade(): void }) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState('month');
  const [every, setEvery] = useState('1');
  const [confirm, setConfirm] = useState(false);
  const [end, setEnd] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  async function make() {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch('/api/recurring', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entryId,
          unit,
          every: Number(every),
          mode: confirm ? 'confirm' : 'auto',
          end: end === '' ? null : end,
        }),
      });
      if (reply.ok) return onMade();
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(data.problems ?? ['That could not be done. Try again.']);
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
    }
  }

  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Repeat…
      </Button>
    );
  return (
    <fieldset className={styles.repeat} aria-label="Repeat this entry">
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={styles.problem}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      <FormField label="Every" required>
        {(field) => (
          <Input
            {...field}
            type="number"
            min={1}
            max={999}
            value={every}
            onChange={(event) => setEvery(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Unit">
        {(field) => (
          <Select {...field} value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="day">Days</option>
            <option value="week">Weeks</option>
            <option value="month">Months</option>
            <option value="year">Years</option>
          </Select>
        )}
      </FormField>
      <FormField label="Stops on" hint="Leave empty to repeat until you end it.">
        {(field) => (
          <Input
            {...field}
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        )}
      </FormField>
      <Checkbox label="Ask me before it posts" checked={confirm} onChange={setConfirm} />
      <div className={styles.actions}>
        <Button disabled={working} onClick={() => void make()}>
          Repeat this entry
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
    </fieldset>
  );
}
