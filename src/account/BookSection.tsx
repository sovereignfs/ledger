'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, FormField, Input, Select } from '@sovereignfs/ui';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import styles from './Account.module.css';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The number formats offered by name; the browser's own is the first, and a locale the book already has that is not here is added to the list. */
const LOCALES: [string, string][] = [
  ['', 'Your browser’s'],
  ['en-US', 'English (United States): 1,234.56'],
  ['en-GB', 'English (United Kingdom): 1,234.56'],
  ['de-DE', 'Deutsch (Deutschland): 1.234,56'],
  ['fr-FR', 'Français (France): 1 234,56'],
  ['es-ES', 'Español (España): 1234,56'],
  ['pt-BR', 'Português (Brasil): 1.234,56'],
  ['ja-JP', '日本語 (日本): 1,234.56'],
  ['en-IN', 'English (India): 1,234.56'],
];

/**
 * Settings, Book (DESIGN.md §15.1, §15.2): the name, the base currency, the time zone, the first day of the week and the number format, which setup chose and which can
 * change. **Nothing already entered is changed by any of them**: a new base currency is what totals are shown in from then on, and the time zone is what decides
 * "today" and a month for posting and the recap. A mistake comes back from the server as sentences.
 */
export function BookSection({
  name,
  baseCurrency,
  timeZone,
  firstDayOfWeek,
  locale,
}: {
  name: string;
  baseCurrency: string | null;
  timeZone: string;
  firstDayOfWeek: number;
  locale: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name,
    baseCurrency: baseCurrency ?? '',
    timeZone,
    firstDayOfWeek,
    locale: locale ?? '',
  });
  const [zones, setZones] = useState<string[]>([timeZone]);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // The browser knows the zones; the server draws the one it has until it is here.
  useEffect(() => {
    try {
      const all =
        (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? [];
      setZones([...new Set(['UTC', timeZone, ...all])]);
    } catch {
      // The list stays the one zone: the book's own.
    }
  }, [timeZone]);
  const locales = LOCALES.some(([tag]) => tag === (locale ?? ''))
    ? LOCALES
    : [...LOCALES, [locale ?? '', locale ?? ''] as [string, string]];

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    setSaved(false);
    try {
      const reply = await fetch('/api/book', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          ...(form.baseCurrency ? { baseCurrency: form.baseCurrency } : {}),
          timeZone: form.timeZone,
          firstDayOfWeek: form.firstDayOfWeek,
          locale: form.locale === '' ? null : form.locale,
        }),
      });
      if (reply.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      const body = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(body.problems ?? ['That could not be saved. Nothing was changed.']);
    } catch {
      setProblems(['That needs a connection. Nothing was changed.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Book</h2>
      <form
        className={styles.form}
        aria-label="Book settings"
        onSubmit={(event) => void save(event)}
      >
        {problems.length > 0 ? (
          <Alert variant="error">
            {problems.map((problem) => (
              <span key={problem}>{problem}</span>
            ))}
          </Alert>
        ) : null}
        <FormField label="Name" required>
          {(field) => (
            <Input
              {...field}
              value={form.name}
              maxLength={80}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </FormField>
        <FormField
          label="Base currency"
          hint="What totals and reports are shown in. Nothing entered is changed."
        >
          {(field) => (
            <CurrencyPicker
              {...field}
              aria-label="Base currency"
              value={form.baseCurrency}
              onChange={(code) => setForm({ ...form, baseCurrency: code })}
            />
          )}
        </FormField>
        <FormField
          label="Time zone"
          hint="What today and a month are, for bills that post themselves, jar contributions and the recap."
        >
          {(field) => (
            <Select
              {...field}
              value={form.timeZone}
              onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="First day of the week">
          {(field) => (
            <Select
              {...field}
              value={String(form.firstDayOfWeek)}
              onChange={(event) => setForm({ ...form, firstDayOfWeek: Number(event.target.value) })}
            >
              {DAYS.map((day, at) => (
                <option key={day} value={String(at)}>
                  {day}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Number format">
          {(field) => (
            <Select
              {...field}
              value={form.locale}
              onChange={(event) => setForm({ ...form, locale: event.target.value })}
            >
              {locales.map(([tag, label]) => (
                <option key={tag} value={tag}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className={styles.row}>
          <Button type="submit" disabled={busy || form.name.trim() === ''}>
            Save
          </Button>
          {saved ? (
            <span role="status" className={styles.hint}>
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
