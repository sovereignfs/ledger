'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, Input, Progress } from '@sovereignfs/ui';
import { BudgetEditor } from '../budget/BudgetEditor';
import { formatMoney } from '../money/text';
import { MoneyInput } from '../ui/MoneyInput';
import type { SavingRow } from './saving';
import styles from './Jars.module.css';

/**
 * The jars of an account (DESIGN.md §10): what each holds and how far it is to its target, to earmark more or release some, to set its monthly contribution
 * (from this month or from next, as any budget), to archive it once it is empty, and to make another. What the account holds, what is in jars and what is free is
 * said above. **Nothing moves between accounts**: a jar is an earmark inside this one. A mistake comes back from the server as sentences, as in the rest of the app.
 */
export function JarsSection({
  accountId,
  currency,
  jars,
  locale,
}: {
  accountId: string;
  currency: string;
  jars: readonly SavingRow[];
  locale: string | undefined;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [name, setName] = useState('');
  const [target, setTarget] = useState<number | null>(null);
  const money = (value: number) => formatMoney(value, currency, locale);

  async function send(path: string, method: 'POST' | 'PATCH', data: unknown): Promise<boolean> {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (reply.ok) {
        router.refresh();
        return true;
      }
      const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(body.problems ?? ['That could not be done. Try again.']);
      return false;
    } catch {
      setProblems(['That needs a connection.']);
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function move(jar: SavingRow, direction: 'earmark' | 'release') {
    const amount = amounts[jar.id];
    if (!amount) return setProblems(['Enter the amount first.']);
    if (await send(`/api/jars/${jar.id}/movements`, 'POST', { direction, amount }))
      setAmounts((now) => ({ ...now, [jar.id]: null }));
  }

  return (
    <section aria-label="Jars" className={styles.jars}>
      <h2>Jars</h2>
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={styles.block}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      {jars.length === 0 ? (
        <p className={styles.note}>
          Nothing is set aside in this account. A jar earmarks some of it for a purpose.
        </p>
      ) : (
        <ul className={styles.list}>
          {jars.map((jar) => (
            <li key={jar.id} className={styles.jar}>
              <div className={styles.line}>
                <strong>{jar.name}</strong>
                <span>
                  {money(jar.balance)}
                  {jar.target !== null ? ` of ${money(jar.target)}` : ''}
                  {jar.monthly ? ` · ${money(jar.monthly)} a month` : ''}
                </span>
              </div>
              {jar.progress !== null ? (
                <Progress
                  value={Math.round(jar.progress * 100)}
                  label={`${jar.name}: ${money(jar.balance)} of ${money(jar.target ?? 0)}`}
                />
              ) : null}
              <div className={styles.actions}>
                <MoneyInput
                  aria-label={`Amount for ${jar.name}`}
                  currency={currency}
                  valueCents={amounts[jar.id] ?? null}
                  onValueChange={(value) => setAmounts((now) => ({ ...now, [jar.id]: value }))}
                />
                <Button
                  size="sm"
                  disabled={working}
                  aria-label={`Earmark in ${jar.name}`}
                  onClick={() => void move(jar, 'earmark')}
                >
                  Earmark
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={working}
                  aria-label={`Release from ${jar.name}`}
                  onClick={() => void move(jar, 'release')}
                >
                  Release
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  aria-label={`Archive ${jar.name}`}
                  onClick={() => void send(`/api/jars/${jar.id}`, 'PATCH', { archived: true })}
                >
                  Archive
                </Button>
              </div>
              <details>
                <summary>Monthly contribution</summary>
                <BudgetEditor kind="jar" id={jar.id} name={jar.name} currency={currency} />
              </details>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.add}
        aria-label="Add a jar"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            if (
              await send('/api/jars', 'POST', {
                accountId,
                name,
                ...(target ? { target } : {}),
              })
            ) {
              setName('');
              setTarget(null);
            }
          })();
        }}
      >
        <FormField label="Jar name" required>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Target" hint="Optional.">
          {(field) => (
            <MoneyInput
              {...field}
              currency={currency}
              valueCents={target}
              onValueChange={setTarget}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" disabled={working}>
            Add jar
          </Button>
        </div>
      </form>
    </section>
  );
}
