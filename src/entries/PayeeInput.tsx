'use client';

import { useEffect, useState } from 'react';
import { SuggestionInput } from '@sovereignfs/ui';

interface Suggested {
  id: string;
  name: string;
  lastSubcategoryId: string | null;
  lastAccountId: string | null;
}

/**
 * The payee field of the add dialog (DESIGN.md §6.5, §14.4): a text field that offers the person's payees as they type, and whose own text is always a valid
 * answer, since a name that is new becomes a payee when the entry is saved. Picking one proposes what was last used with it. The suggestions are the account's
 * own, asked of the server a moment after the typing stops.
 */
export function PayeeInput({
  value,
  onChange,
  onPick,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (payee: Suggested) => void;
  id?: string;
  'aria-describedby'?: string;
  required?: boolean;
}) {
  const [found, setFound] = useState<Suggested[]>([]);
  useEffect(() => {
    if (value.trim() === '') {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const reply = await fetch(`/api/payees?q=${encodeURIComponent(value.trim())}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (reply.ok) setFound(((await reply.json()) as { payees: Suggested[] }).payees);
        } catch {
          // No suggestions is not an error: the typed name still works.
        }
      })();
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  return (
    <SuggestionInput
      {...rest}
      aria-label="Payee"
      value={value}
      onChange={onChange}
      options={found.map((payee) => ({ id: payee.id, label: payee.name }))}
      onSelect={(option) => {
        const payee = found.find((each) => each.id === option.id);
        if (payee) onPick(payee);
      }}
    />
  );
}
