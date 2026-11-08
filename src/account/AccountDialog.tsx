'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Dialog } from '@sovereignfs/ui';

/** Settings as a dialog over the page it was opened from (`app/(app)/@modal/(.)account`): closing it goes back to that page, as the browser's back button does. */
export function AccountDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <Dialog open onClose={() => router.back()} size="fixed" aria-label="Settings" title="Settings">
      {children}
    </Dialog>
  );
}
