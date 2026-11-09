'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, FormField, Input, Select, StepStrip } from '@sovereignfs/ui';
import { formatMoney } from '../money/text';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import { MoneyInput } from '../ui/MoneyInput';
import { currencyForLocale } from './locale';
import type { SetupState } from './setup';
import styles from './Setup.module.css';

const STEPS = [
  { id: 'currency', label: 'Currency' },
  { id: 'account', label: 'First account' },
  { id: 'income', label: 'Income' },
  { id: 'categories', label: 'Categories' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

/** The categories offered to start with (DESIGN.md §15.3), none made until chosen. */
export const SUGGESTIONS = [
  'Housing',
  'Groceries',
  'Transport',
  'Eating out',
  'Utilities',
  'Health',
  'Fun',
] as const;

const ACCOUNT_KINDS = [
  { value: 'bank', label: 'Bank account' },
  { value: 'cash', label: 'Cash' },
  { value: 'savings', label: 'Savings' },
] as const;

/**
 * The setup wizard (DESIGN.md §15.3): four steps, **each a real write**, so a refresh loses nothing and going back and forward makes no duplicate: what is done is
 * read from the book, the next step is the first that is not, and a repeat of a step finds what is there. The base currency is guessed from the browser's locale
 * and the time zone is taken from it; both are only a start, confirmed here. Nothing is made without a tap: the suggested categories are made only when chosen.
 */
export function SetupWizard({
  initial,
  today,
  locale,
}: {
  initial: SetupState;
  today: string;
  locale?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [step, setStep] = useState<StepId>(STEPS[initial.step - 1]?.id ?? 'currency');
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const [currency, setCurrency] = useState(initial.baseCurrency ?? 'USD');
  useEffect(() => {
    if (initial.baseCurrency === null) setCurrency(currencyForLocale(navigator.language));
  }, [initial.baseCurrency]);

  const [kind, setKind] = useState<string>('bank');
  const [accountName, setAccountName] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [incomeName, setIncomeName] = useState(initial.income?.name ?? 'Salary');
  const [incomeAmount, setIncomeAmount] = useState<number | null>(initial.income?.budgeted ?? null);
  const [chosen, setChosen] = useState<Record<string, number | null>>({});

  const base = state.baseCurrency ?? currency;

  /** One step of the wizard, to the server; on success the state it answers with is the truth. */
  async function send(body: Record<string, unknown>): Promise<SetupState | undefined> {
    setWorking(true);
    setProblems([]);
    try {
      const reply = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await reply.json().catch(() => ({}))) as {
        state?: SetupState;
        problems?: string[];
      };
      if (!reply.ok || !data.state) {
        setProblems(data.problems ?? ['That could not be done. Nothing was changed.']);
        return undefined;
      }
      setState(data.state);
      return data.state;
    } catch {
      setProblems(['That needs a connection. Nothing was changed.']);
      return undefined;
    } finally {
      setWorking(false);
    }
  }

  const finish = async () => {
    if (await send({ step: 'done' })) {
      router.push('/');
      router.refresh();
    }
  };

  const reachable = (id: StepId) => STEPS.findIndex((each) => each.id === id) <= state.step - 1;
  const go = (id: StepId) => {
    setProblems([]);
    setStep(id);
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Set up your budget</h1>
        <p className={styles.lede}>
          Four short steps. Each is saved as you go, so you can leave and come back.
        </p>
        <StepStrip
          aria-label="Steps"
          items={[...STEPS]}
          activeId={step}
          renderItem={(item, { isActive, index }) => (
            <button
              type="button"
              className={styles.step}
              aria-current={isActive ? 'step' : undefined}
              disabled={!reachable(item.id)}
              onClick={() => go(item.id)}
            >
              {index + 1}. {item.label}
            </button>
          )}
        />
        {problems.length > 0 ? (
          <Alert variant="error">
            {problems.map((problem) => (
              <span key={problem} className={styles.problem}>
                {problem}
              </span>
            ))}
          </Alert>
        ) : null}

        {step === 'currency' ? (
          <form
            className={styles.form}
            aria-label="Currency"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (await send({ step: 'currency', currency, ...(timeZone ? { timeZone } : {}) }))
                  go('account');
              })();
            }}
          >
            <h2>Your currency</h2>
            <p className={styles.note}>
              Totals and reports are in this one. You can change it later; nothing already entered
              is re-priced.
            </p>
            <FormField label="Base currency" required>
              {(field) => <CurrencyPicker {...field} value={currency} onChange={setCurrency} />}
            </FormField>
            <div className={styles.actions}>
              <Button type="submit" disabled={working || currency === ''}>
                Continue
              </Button>
            </div>
          </form>
        ) : null}

        {step === 'account' ? (
          state.account ? (
            <div className={styles.form}>
              <h2>Your first account</h2>
              <p>
                <strong>{state.account.name}</strong> is made, with{' '}
                {formatMoney(state.account.balance, state.account.currency, locale)} in it. More
                accounts, cards and loans come after setup.
              </p>
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => go('currency')}>
                  Back
                </Button>
                <Button onClick={() => go('income')}>Continue</Button>
              </div>
            </div>
          ) : (
            <form
              className={styles.form}
              aria-label="First account"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  if (
                    await send({
                      step: 'account',
                      type: kind,
                      name: accountName,
                      balance,
                      date: today,
                    })
                  )
                    go('income');
                })();
              }}
            >
              <h2>Your first account</h2>
              <p className={styles.note}>
                Where your money is, and what is in it today. It is in {base}.
              </p>
              <FormField label="Kind">
                {(field) => (
                  <Select {...field} value={kind} onChange={(event) => setKind(event.target.value)}>
                    {ACCOUNT_KINDS.map((each) => (
                      <option key={each.value} value={each.value}>
                        {each.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label="Name" required>
                {(field) => (
                  <Input
                    {...field}
                    value={accountName}
                    maxLength={80}
                    onChange={(event) => setAccountName(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label="What is in it today" hint="Optional.">
                {(field) => (
                  <MoneyInput
                    {...field}
                    currency={base}
                    valueCents={balance}
                    onValueChange={setBalance}
                  />
                )}
              </FormField>
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => go('currency')}>
                  Back
                </Button>
                <Button type="submit" disabled={working || accountName.trim() === ''}>
                  Continue
                </Button>
              </div>
            </form>
          )
        ) : null}

        {step === 'income' ? (
          <form
            className={styles.form}
            aria-label="Income"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                if (await send({ step: 'income', name: incomeName, amount: incomeAmount }))
                  go('categories');
              })();
            }}
          >
            <h2>Your main income</h2>
            <p className={styles.note}>
              What you are paid, and about how much each month. More sources can be added later.
            </p>
            <FormField label="Name" required>
              {(field) => (
                <Input
                  {...field}
                  value={incomeName}
                  maxLength={60}
                  onChange={(event) => setIncomeName(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Each month" hint="Optional.">
              {(field) => (
                <MoneyInput
                  {...field}
                  currency={base}
                  valueCents={incomeAmount}
                  onValueChange={setIncomeAmount}
                />
              )}
            </FormField>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => go('account')}>
                Back
              </Button>
              <Button type="submit" disabled={working || incomeName.trim() === ''}>
                Continue
              </Button>
            </div>
          </form>
        ) : null}

        {step === 'categories' ? (
          <form
            className={styles.form}
            aria-label="Categories"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                const items = Object.entries(chosen).map(([name, amount]) => ({ name, amount }));
                if (items.length > 0 && !(await send({ step: 'categories', items }))) return;
                await finish();
              })();
            }}
          >
            <h2>Your first categories</h2>
            <p className={styles.note}>
              Tap the ones you want, and say about how much you spend on each in a month. Nothing is
              made for what you do not tap.
              {state.subcategories > 0 ? ` You have ${state.subcategories} already.` : ''}
            </p>
            <ul className={styles.chips}>
              {SUGGESTIONS.map((name) => (
                <li key={name} className={styles.chip}>
                  <Checkbox
                    label={name}
                    checked={name in chosen}
                    onChange={(on) =>
                      setChosen((now) =>
                        on
                          ? { ...now, [name]: null }
                          : Object.fromEntries(
                              Object.entries(now).filter(([each]) => each !== name),
                            ),
                      )
                    }
                  />
                  {name in chosen ? (
                    <MoneyInput
                      aria-label={`Budgeted a month for ${name}`}
                      currency={base}
                      valueCents={chosen[name] ?? null}
                      onValueChange={(amount) => setChosen((now) => ({ ...now, [name]: amount }))}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => go('income')}>
                Back
              </Button>
              <Button type="submit" disabled={working}>
                {Object.keys(chosen).length > 0 ? 'Finish' : 'Finish without categories'}
              </Button>
            </div>
          </form>
        ) : null}

        <p className={styles.note}>
          <button
            type="button"
            className={styles.step}
            disabled={working}
            onClick={() => void finish()}
          >
            Skip setup: I will do it myself
          </button>
        </p>
      </div>
    </main>
  );
}
