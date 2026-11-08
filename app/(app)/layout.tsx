import type { ReactNode } from 'react';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';

/** The signed-in area: the shell around every place. Finding the session joins it with sign-in (task 2.1). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell name={site.name}>{children}</AppShell>;
}
