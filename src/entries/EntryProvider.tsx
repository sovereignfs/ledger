'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, FormField, Input, Select, SegmentedControl } from '@sovereignfs/ui';
import type { EntryOptions } from '../ledger/entries';
import { MoneyInput } from '../ui/MoneyInput';
import {
  type EntryForm,
  type Part,
  compose,
  editable,
  formOf,
  missing,
  remainder,
} from './compose';
import { formatMoney } from '../money/text';
import { TargetSelect } from './TargetSelect';
import { monthNote } from './month';
import { EntrySurface } from './EntrySurface';
import styles from './Entry.module.css';

/**
 * The add dialog (DESIGN.md §14.4), **reachable from anywhere**: a `Dialog` on a wide screen and a `Drawer` on a narrow one, with the same form. The page
 * calls `openAdd()` or `openEdit(id)`; what the form offers is fetched when it opens, so it is the person's book as it is now. Enter saves; "Save and add
 * another" keeps the date and the account and clears the rest. **It answers at once**: a save closes the dialog and says so, and a refusal opens it again with
 * what was typed and the sentence that says why, so nothing is lost. The last account is remembered on this device. Reopening shows a blank form.
 */
interface EntryApi {
  openAdd(): void;
  openEdit(id: string): void;
}

const Context = createContext<EntryApi | null>(null);

/** The way to open the dialog, for a button anywhere under the provider. */
export function useEntryDialog(): EntryApi {
  const api = useContext(Context);
  if (!api) throw new Error('useEntryDialog is used under an EntryProvider');
  return api;
}

const LAST_ACCOUNT = 'ledger:last-account';

function remembered(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}
function remember(id: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT, id);
  } catch {
    // Nothing is lost: the dialog starts on the first account instead.
  }
}

const BLANK: EntryForm = {
  type: 'expense',
  amount: null,
  accountId: '',
  currency: 'USD',
  targetId: '',
  split: false,
  parts: [],
  date: '',
  note: '',
};

type Mode = { kind: 'add' } | { kind: 'edit'; id: string };

export function EntryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'add' });
  const [options, setOptions] = useState<EntryOptions | null>(null);
  const [form, setForm] = useState<EntryForm>(BLANK);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [notEditable, setNotEditable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fail = (...sentences: string[]) => setProblems(sentences);

  const loadOptions = useCallback(async (): Promise<EntryOptions | null> => {
    try {
      const reply = await fetch('/api/entry-options', { cache: 'no-store' });
      if (!reply.ok) return null;
      const loaded = (await reply.json()) as EntryOptions;
      setOptions(loaded);
      return loaded;
    } catch {
      return null;
    }
  }, []);

  const openAdd = useCallback(() => {
    setMode({ kind: 'add' });
    setProblems([]);
    setNotEditable(false);
    setConfirmDelete(false);
    setForm(BLANK);
    setOpen(true);
    void (async () => {
      const loaded = await loadOptions();
      if (!loaded) return fail('This needs a connection.');
      const last = remembered();
      const account = loaded.accounts.find((each) => each.id === last) ?? loaded.accounts[0];
      setForm({
        ...BLANK,
        accountId: account?.id ?? '',
        currency: account?.currency ?? 'USD',
        date: loaded.today,
      });
    })();
  }, [loadOptions]);

  const openEdit = useCallback(
    (id: string) => {
      setMode({ kind: 'edit', id });
      setProblems([]);
      setNotEditable(false);
      setConfirmDelete(false);
      setForm(BLANK);
      setOpen(true);
      void (async () => {
        const loaded = await loadOptions();
        try {
          const reply = await fetch(`/api/transactions/${id}`, { cache: 'no-store' });
          if (!loaded || !reply.ok)
            return fail('That could not be opened. It may have been deleted.');
          const { entry } = (await reply.json()) as {
            entry: Parameters<typeof editable>[0] & Parameters<typeof formOf>[0];
          };
          if (editable(entry)) setForm(formOf(entry));
          else setNotEditable(true);
        } catch {
          fail('This needs a connection.');
        }
      })();
    },
    [loadOptions],
  );

  const api = useMemo(() => ({ openAdd, openEdit }), [openAdd, openEdit]);

  const account = options?.accounts.find((each) => each.id === form.accountId);
  const set = (change: Partial<EntryForm>) => setForm((now) => ({ ...now, ...change }));

  /** Sends the form. A save that is not "add another" closes at once, and a refusal opens it again with what was typed. */
  async function submit(another: boolean) {
    const problem = missing(form);
    if (problem) return fail(problem);
    setProblems([]);
    const entry = compose(form);
    const editing = mode.kind === 'edit';
    if (!another) {
      setOpen(false);
      setStatus(editing ? 'Saving the change…' : 'Saving…');
    }
    setWorking(true);
    try {
      const reply = await fetch(editing ? `/api/transactions/${mode.id}` : '/api/transactions', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (reply.ok) {
        remember(form.accountId);
        setStatus(editing ? 'Changed.' : 'Saved.');
        router.refresh();
        if (another) set({ amount: null, targetId: '', split: false, parts: [], note: '' });
        return;
      }
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setStatus('');
      setOpen(true);
      fail(...(data.problems ?? ['That could not be saved. Nothing was changed.']));
    } catch {
      setStatus('');
      setOpen(true);
      fail('That needs a connection. Nothing was saved.');
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (mode.kind !== 'edit') return;
    setWorking(true);
    try {
      const reply = await fetch(`/api/transactions/${mode.id}`, { method: 'DELETE' });
      if (reply.ok || reply.status === 404) {
        setOpen(false);
        setStatus('Deleted.');
        router.refresh();
      } else fail('That could not be deleted. Try again.');
    } catch {
      fail('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  const targets = form.type === 'expense';
  const what = targets ? 'Subcategory' : 'Income source';
  const left = remainder(form);
  const setPart = (at: number, change: Partial<Part>) =>
    set({ parts: form.parts.map((part, each) => (each === at ? { ...part, ...change } : part)) });
  const note = monthNote(form.date, options?.today ?? '');
  const title = mode.kind === 'edit' ? 'Edit entry' : 'Add entry';

  const body = (
    <form
      className={styles.form}
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      {problems.length > 0 ? (
        <Alert variant="error">
          {problems.map((problem) => (
            <span key={problem} className={styles.problem}>
              {problem}
            </span>
          ))}
        </Alert>
      ) : null}
      {notEditable ? (
        <>
          <p>
            This entry has several parts, or more than one account, so it is not edited here. It can
            be deleted.
          </p>
          <div className={styles.actions}>
            {confirmDelete ? (
              <Button variant="destructive" disabled={working} onClick={() => void remove()}>
                Delete for good
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <>
          <SegmentedControl<EntryForm['type']>
            aria-label="Type"
            value={form.type}
            onChange={(type) => set({ type, targetId: '', split: false, parts: [] })}
            options={[
              { label: 'Expense', value: 'expense' },
              { label: 'Income', value: 'income' },
            ]}
          />
          <FormField label="Amount" required>
            {(field) => (
              <MoneyInput
                {...field}
                currency={form.currency}
                valueCents={form.amount}
                onValueChange={(amount) => set({ amount })}
              />
            )}
          </FormField>
          <FormField label="Account" required>
            {(field) => (
              <Select
                {...field}
                value={form.accountId}
                onChange={(event) => {
                  const next = options?.accounts.find((each) => each.id === event.target.value);
                  set({ accountId: event.target.value, currency: next?.currency ?? form.currency });
                }}
              >
                {options?.accounts.length ? null : <option value="">No accounts yet</option>}
                {options?.accounts.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name} · {each.currency}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {!form.split ? (
            <>
              <FormField label={what} required>
                {(field) => (
                  <TargetSelect
                    {...field}
                    options={options}
                    expense={targets}
                    value={form.targetId}
                    onChange={(targetId) => set({ targetId })}
                  />
                )}
              </FormField>
              <div className={styles.actions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set({
                      split: true,
                      parts: [
                        { targetId: form.targetId, amount: form.amount },
                        { targetId: '', amount: null },
                      ],
                    })
                  }
                >
                  Split
                </Button>
              </div>
            </>
          ) : (
            <fieldset className={styles.parts}>
              <legend>Split</legend>
              {form.parts.map((part, at) => (
                <div key={at} className={styles.part}>
                  <TargetSelect
                    aria-label={`${what} of part ${at + 1}`}
                    options={options}
                    expense={targets}
                    value={part.targetId}
                    onChange={(targetId) => setPart(at, { targetId })}
                  />
                  <MoneyInput
                    aria-label={`Amount of part ${at + 1}`}
                    currency={form.currency}
                    valueCents={part.amount}
                    onValueChange={(amount) => setPart(at, { amount })}
                  />
                  {form.parts.length > 2 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove part ${at + 1}`}
                      onClick={() => set({ parts: form.parts.filter((_, each) => each !== at) })}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              <p role="status" className={styles.remainder}>
                {left === 0
                  ? 'The parts add up.'
                  : left > 0
                    ? `${formatMoney(left, form.currency)} left to place.`
                    : `${formatMoney(-left, form.currency)} over.`}
              </p>
              <div className={styles.actions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set({
                      parts: [...form.parts, { targetId: '', amount: left > 0 ? left : null }],
                    })
                  }
                >
                  Add a part
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set({ split: false, targetId: form.parts[0]?.targetId ?? '', parts: [] })
                  }
                >
                  Not split
                </Button>
              </div>
            </fieldset>
          )}
          <FormField label="Date" required hint={note || undefined}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={form.date}
                onChange={(event) => set({ date: event.target.value })}
              />
            )}
          </FormField>
          <FormField label="Note">
            {(field) => (
              <Input
                {...field}
                value={form.note}
                maxLength={1000}
                onChange={(event) => set({ note: event.target.value })}
              />
            )}
          </FormField>
          <div className={styles.actions}>
            <Button type="submit" disabled={working || !account}>
              {mode.kind === 'edit' ? 'Save changes' : 'Save'}
            </Button>
            {mode.kind === 'add' ? (
              <Button
                variant="secondary"
                disabled={working || !account}
                onClick={() => void submit(true)}
              >
                Save and add another
              </Button>
            ) : confirmDelete ? (
              <Button variant="destructive" disabled={working} onClick={() => void remove()}>
                Delete for good
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  );

  return (
    <Context.Provider value={api}>
      {children}
      <div role="status" aria-live="polite" className={styles.status}>
        {status}
      </div>
      <EntrySurface open={open} onClose={() => setOpen(false)} title={title}>
        {body}
      </EntrySurface>
    </Context.Provider>
  );
}
