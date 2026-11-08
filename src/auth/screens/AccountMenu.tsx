'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UserMenu } from '@sovereignfs/ui';
import { authClient } from '../client';

/**
 * The avatar menu at the right of the header: who the person is (name and address) and *Settings* and *Sign out*. Signing
 * out needs the server, so that no one else can use the session: a failure to reach it is said, and the person stays signed in.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    const { error } = await authClient.signOut();
    // A session that is already gone is as signed out as one that was just ended; only a failure to reach the server is a failure.
    if (error && error.status !== 401) {
      setLeaving(false);
      return;
    }
    window.location.assign('/');
  }

  return (
    <UserMenu
      name={name}
      email={email}
      size="sm"
      aria-label="User menu"
      items={[
        // A soft navigation, so that Settings is a dialog over this page and not a page that replaces it (`app/(app)/@modal/(.)account`).
        { label: 'Settings', icon: 'settings', onSelect: () => router.push('/account') },
        {
          label: leaving ? 'Signing out…' : 'Sign out',
          icon: 'log-out',
          destructive: true,
          onSelect: () => void signOut(),
        },
      ]}
    />
  );
}
