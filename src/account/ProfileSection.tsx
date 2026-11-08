'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { messageFor } from '../auth/messages';
import { authClient } from '../auth/client';
import { Alert, Avatar, Button, FormField, Input } from '@sovereignfs/ui';
import styles from './Account.module.css';

/** The longest a display name may be: a line, as a person writes their own. */
export const MAX_NAME_LENGTH = 100;

/**
 * Settings, Profile (DESIGN.md §15.1): who the person is here. Their initials, the name they are shown under (in the header's menu and in the recap's greeting), which
 * they can change, and their address, which is shown and is not changed here. Saving the name needs a connection, and says so when there is none.
 */
export function ProfileSection({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const trimmed = value.trim();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { error: failure } = await authClient.updateUser({ name: trimmed });
      if (failure) {
        setError(messageFor(failure));
        return;
      }
      setValue(trimmed);
      setSaved(true);
      // The menu, and every page that says who is signed in, read it from the session.
      router.refresh();
    } catch {
      setError('This needs a connection. Try again when you are back online.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.group}>
        <h2>Avatar</h2>
        <div className={styles.row}>
          <Avatar name={name} size="lg" />
          <p className={styles.hint}>Your initials.</p>
        </div>
      </div>
      <div className={styles.group}>
        <h2>Display name</h2>
        <form onSubmit={onSubmit} className={styles.form} aria-label="Display name">
          {error ? <Alert variant="error">{error}</Alert> : null}
          {saved ? <Alert variant="success">Your name is saved.</Alert> : null}
          <FormField
            label="Name"
            required
            error={
              trimmed.length > MAX_NAME_LENGTH
                ? `At most ${MAX_NAME_LENGTH} characters.`
                : undefined
            }
          >
            {(field) => (
              <Input
                {...field}
                name="name"
                autoComplete="name"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setSaved(false);
                }}
                disabled={busy}
              />
            )}
          </FormField>
          <div>
            <Button
              type="submit"
              loading={busy}
              disabled={trimmed === '' || trimmed === name || trimmed.length > MAX_NAME_LENGTH}
            >
              Save name
            </Button>
          </div>
        </form>
      </div>
      <div className={styles.group}>
        <h2>Email address</h2>
        <p>{email}</p>
        <p className={styles.hint}>The address you sign in with.</p>
      </div>
    </>
  );
}
