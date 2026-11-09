'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, FormField, Input, Select } from '@sovereignfs/ui';
import { formatMoney } from '../money/text';
import { MoneyInput } from '../ui/MoneyInput';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import type { IncomeRow } from './income';
import styles from './Categories.module.css';

/**
 * Income sources and what each is budgeted and has received (DESIGN.md §7.4): add one (the first is the primary), rename it, make another the primary, archive
 * or delete it (not the primary, and not one income has been received from), and set what it is budgeted **from this month or from next**, which never
 * rewrites a past month (§7.3). What is received is read from the entries; it is shown here, not typed.
 */
export function IncomeManager({
  rows,
  baseCurrency,
  locale,
}: {
  rows: readonly IncomeRow[];
  baseCurrency: string | null;
  locale?: string;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(baseCurrency ?? 'USD');
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [when, setWhen] = useState<Record<string, 'this' | 'next'>>({});
  const [working, setWorking] = useState(false);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      <form
        className={styles.add}
        aria-label="Add income source"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = name;
          setName('');
          void (async () => {
            if (!(await send('/api/income-sources', 'POST', { name: typed, currency })))
              setName((now) => now || typed);
          })();
        }}
      >
        <FormField label="New income source" required>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        {baseCurrency === null ? (
          <FormField label="Currency">
            {(field) => <CurrencyPicker {...field} value={currency} onChange={setCurrency} />}
          </FormField>
        ) : null}
        <Button type="submit" disabled={working || name.trim() === ''}>
          Add income source
        </Button>
      </form>

      {rows.map(({ source, budgeted, received }) => (
        <section key={source.id} className={styles.category} aria-label={source.name}>
          <div className={styles.line}>
            <span className={styles.label}>
              {source.name} · {source.currency}{' '}
              <Badge variant="status" status={source.kind === 'primary' ? 'active' : 'neutral'}>
                {source.kind === 'primary' ? 'Primary' : 'Secondary'}
              </Badge>
              {source.archivedAt ? ' · Archived' : ''}
            </span>
            <span className={styles.controls}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${source.name}`}
                disabled={working}
                onClick={() => {
                  const next = window.prompt('Rename income source', source.name);
                  if (next !== null)
                    void send(`/api/income-sources/${source.id}`, 'PATCH', { name: next });
                }}
              >
                Rename
              </Button>
              {source.kind !== 'primary' && !source.archivedAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Make ${source.name} the primary`}
                  disabled={working}
                  onClick={() =>
                    void send(`/api/income-sources/${source.id}`, 'PATCH', { primary: true })
                  }
                >
                  Make primary
                </Button>
              ) : null}
              {source.kind !== 'primary' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${source.archivedAt ? 'Bring back' : 'Archive'} ${source.name}`}
                  disabled={working}
                  onClick={() =>
                    void send(`/api/income-sources/${source.id}`, 'PATCH', {
                      archived: !source.archivedAt,
                    })
                  }
                >
                  {source.archivedAt ? 'Bring back' : 'Archive'}
                </Button>
              ) : null}
              {source.kind !== 'primary' && source.entries === 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${source.name}`}
                  disabled={working}
                  onClick={() => void send(`/api/income-sources/${source.id}`, 'DELETE')}
                >
                  Delete
                </Button>
              ) : null}
            </span>
          </div>
          <p className={styles.note}>
            Budgeted{' '}
            {budgeted === null ? 'nothing yet' : formatMoney(budgeted, source.currency, locale)} ·
            Received{' '}
            {received.length === 0
              ? formatMoney(0, source.currency, locale)
              : received.map((each) => formatMoney(each.amount, each.currency, locale)).join(' + ')}
          </p>
          {!source.archivedAt ? (
            <form
              className={styles.inline}
              aria-label={`Budget for ${source.name}`}
              onSubmit={(event) => {
                event.preventDefault();
                const amount = amounts[source.id];
                if (amount === null || amount === undefined)
                  return setProblems(['Enter the amount to budget.']);
                void send('/api/budget', 'POST', {
                  kind: 'income',
                  id: source.id,
                  amount,
                  when: when[source.id] ?? 'this',
                });
              }}
            >
              <MoneyInput
                aria-label={`Budgeted amount for ${source.name}`}
                currency={source.currency}
                valueCents={amounts[source.id] ?? null}
                onValueChange={(amount) => setAmounts((now) => ({ ...now, [source.id]: amount }))}
              />
              <Select
                aria-label={`From, for ${source.name}`}
                size="sm"
                value={when[source.id] ?? 'this'}
                onChange={(event) =>
                  setWhen((now) => ({ ...now, [source.id]: event.target.value as 'this' | 'next' }))
                }
              >
                <option value="this">From this month</option>
                <option value="next">From next month</option>
              </Select>
              <Button type="submit" size="sm" disabled={working}>
                Set
              </Button>
            </form>
          ) : null}
        </section>
      ))}
    </div>
  );
}
