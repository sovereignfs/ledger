'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, FormField, Input } from '@sovereignfs/ui';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import type { CategoryRow } from './categories';
import styles from './Categories.module.css';

/**
 * Categories and their subcategories (DESIGN.md §7.1): make, rename, put in order, archive and delete, all from one page. **Delete is offered only where
 * nothing has been spent**; where something has, archiving is, and the page says why. A subcategory is spent on by an expense line; archiving takes it out of the
 * pickers and leaves it in past months.
 */
export function CategoriesManager({
  categories,
  baseCurrency,
}: {
  categories: readonly CategoryRow[];
  baseCurrency: string | null;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(baseCurrency ?? 'USD');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  /** One request; on success the page is read again, on failure the sentences are shown. */
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

  const live = categories.filter((category) => category.archivedAt === null);
  const archived = categories.filter((category) => category.archivedAt !== null);

  function move(list: readonly { id: string }[], id: string, by: -1 | 1): string[] | null {
    const at = list.findIndex((each) => each.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return null;
    const ids = list.map((each) => each.id);
    [ids[at], ids[to]] = [ids[to] as string, ids[at] as string];
    return ids;
  }

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className={styles.line}>
        <span className={styles.label}>{label}</span>
        <span className={styles.controls}>{children}</span>
      </div>
    );
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
        aria-label="Add category"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = name;
          setName('');
          void (async () => {
            if (!(await send('/api/categories', 'POST', { name: typed, currency })))
              setName((now) => now || typed);
          })();
        }}
      >
        <FormField label="New category" required>
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
          <FormField label="Currency" hint="Its budget is kept in this currency.">
            {(field) => <CurrencyPicker {...field} value={currency} onChange={setCurrency} />}
          </FormField>
        ) : null}
        <Button type="submit" disabled={working || name.trim() === ''}>
          Add category
        </Button>
      </form>

      {live.map((category) => (
        <section key={category.id} className={styles.category} aria-label={category.name}>
          {editing === category.id ? (
            <form
              className={styles.inline}
              aria-label={`Rename ${category.name}`}
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  if (await send(`/api/categories/${category.id}`, 'PATCH', { name: draft }))
                    setEditing(null);
                })();
              }}
            >
              <Input
                aria-label="Name"
                value={draft}
                maxLength={60}
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
            <Row label={`${category.name} · ${category.currency}`}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${category.name} up`}
                disabled={working}
                onClick={() => {
                  const ids = move(live, category.id, -1);
                  if (ids) void send('/api/categories', 'PUT', { order: ids });
                }}
              >
                Up
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${category.name} down`}
                disabled={working}
                onClick={() => {
                  const ids = move(live, category.id, 1);
                  if (ids) void send('/api/categories', 'PUT', { order: ids });
                }}
              >
                Down
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(category.id);
                  setDraft(category.name);
                }}
              >
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() =>
                  void send(`/api/categories/${category.id}`, 'PATCH', { archived: true })
                }
              >
                Archive
              </Button>
              {category.deletable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  onClick={() => void send(`/api/categories/${category.id}`, 'DELETE')}
                >
                  Delete
                </Button>
              ) : null}
            </Row>
          )}
          <ul className={styles.subs}>
            {category.subcategories
              .filter((sub) => sub.archivedAt === null)
              .map((sub, _at, subs) => (
                <li key={sub.id}>
                  <Row label={sub.name}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${sub.name} up`}
                      disabled={working}
                      onClick={() => {
                        const ids = move(subs, sub.id, -1);
                        if (ids)
                          void send(`/api/categories/${category.id}`, 'PATCH', { order: ids });
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${sub.name} down`}
                      disabled={working}
                      onClick={() => {
                        const ids = move(subs, sub.id, 1);
                        if (ids)
                          void send(`/api/categories/${category.id}`, 'PATCH', { order: ids });
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${sub.name}`}
                      disabled={working}
                      onClick={() => {
                        const next = window.prompt('Rename subcategory', sub.name);
                        if (next !== null)
                          void send(`/api/subcategories/${sub.id}`, 'PATCH', { name: next });
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={
                        sub.budgetSource === 'bills'
                          ? `Budget ${sub.name} by hand`
                          : `Budget ${sub.name} by its bills`
                      }
                      disabled={working}
                      onClick={() =>
                        void send(`/api/subcategories/${sub.id}`, 'PATCH', {
                          budgetSource: sub.budgetSource === 'bills' ? 'manual' : 'bills',
                        })
                      }
                    >
                      {sub.budgetSource === 'bills' ? 'By hand' : 'By bills'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Archive ${sub.name}`}
                      disabled={working}
                      onClick={() =>
                        void send(`/api/subcategories/${sub.id}`, 'PATCH', { archived: true })
                      }
                    >
                      Archive
                    </Button>
                    {!sub.used ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${sub.name}`}
                        disabled={working}
                        onClick={() => void send(`/api/subcategories/${sub.id}`, 'DELETE')}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </Row>
                </li>
              ))}
          </ul>
          <form
            className={styles.inline}
            aria-label={`Add a subcategory to ${category.name}`}
            onSubmit={(event) => {
              event.preventDefault();
              const typed = adding[category.id] ?? '';
              // Cleared at once, so what is typed next is not lost to the answer to this; put back if this is refused.
              setAdding((now) => ({ ...now, [category.id]: '' }));
              void (async () => {
                if (
                  !(await send(`/api/categories/${category.id}/subcategories`, 'POST', {
                    name: typed,
                  }))
                )
                  setAdding((now) => ({ ...now, [category.id]: now[category.id] || typed }));
              })();
            }}
          >
            <Input
              aria-label={`New subcategory in ${category.name}`}
              placeholder="New subcategory"
              value={adding[category.id] ?? ''}
              maxLength={60}
              onChange={(event) =>
                setAdding((now) => ({ ...now, [category.id]: event.target.value }))
              }
            />
            <Button
              type="submit"
              size="sm"
              disabled={working || (adding[category.id] ?? '').trim() === ''}
            >
              Add
            </Button>
          </form>
          {!category.deletable ? (
            <p className={styles.note}>
              Something has been spent here, so it is archived and not deleted: it stays in past
              months.
            </p>
          ) : null}
        </section>
      ))}

      {archived.length > 0 ? (
        <section className={styles.category} aria-label="Archived categories">
          <h2>Archived</h2>
          {archived.map((category) => (
            <Row key={category.id} label={`${category.name} · ${category.currency}`}>
              <Button
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() =>
                  void send(`/api/categories/${category.id}`, 'PATCH', { archived: false })
                }
              >
                Bring back
              </Button>
            </Row>
          ))}
        </section>
      ) : null}
    </div>
  );
}
