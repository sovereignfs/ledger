'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import { CURRENCY_OPTIONS } from '../money/currencies';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import styles from './Account.module.css';

/**
 * Settings, Currencies (DESIGN.md §9.2, §15.1): the currencies the book uses, which are the ones the day's rates are fetched for. One is added by an account, a category or an
 * income source that is in it; here one can be added by itself, before anything is in it. One is never taken away: what was entered in it stays.
 */
export function CurrenciesSection({
  codes,
  base,
}: {
  codes: readonly string[];
  base: string | null;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const left = CURRENCY_OPTIONS.filter((option) => !codes.includes(option.code));

  async function add() {
    if (chosen === '') return;
    setBusy(true);
    setProblems([]);
    try {
      const reply = await fetch('/api/book/currencies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: chosen }),
      });
      if (reply.ok) {
        setChosen('');
        router.refresh();
        return;
      }
      const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(body.problems ?? ['That could not be added.']);
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Currencies</h2>
      <p className={styles.hint}>
        The currencies in this book. The exchange rates of each are kept daily.
      </p>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </Alert>
      ) : null}
      <ul aria-label="Currencies in this book">
        {codes.map((code) => (
          <li key={code}>
            {code}
            {code === base ? ' · base currency' : ''}
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <CurrencyPicker
          aria-label="Currency to add"
          value={chosen}
          onChange={setChosen}
          options={left}
        />
        <Button disabled={busy || chosen === ''} onClick={() => void add()}>
          Add currency
        </Button>
      </div>
    </div>
  );
}
