import type { ReactNode } from 'react';
import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { requireSession } from '@/src/auth/session';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';

// Every page here is for someone signed in, so it is decided per request, from the cookie.
export const dynamic = 'force-dynamic';

/** The signed-in area: the shell around every place, for a person with a session. A visitor is sent to sign in; with no sign-in on, there is no such place. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return (
    <AppShell
      name={site.name}
      account={<AccountMenu name={session.user.name} email={session.user.email} />}
    >
      {children}
    </AppShell>
  );
}
