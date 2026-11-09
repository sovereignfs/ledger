'use client';

import type { ReactNode } from 'react';
import { Dialog, Drawer, useIsMobile } from '@sovereignfs/ui';

/**
 * What the add dialog is drawn on (DESIGN.md §14.4, §14.6): a `Dialog` on a wide screen and a `Drawer` on a narrow one, with the same content. **This is the only
 * place that asks the width, and it decides nothing but what is drawn**: the form, what it fetches and where it goes are the same at every width, and
 * `no-fork.test.ts` holds this file to that.
 */
export function EntrySurface({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return mobile ? (
    <Drawer open={open} onClose={onClose} aria-label={title} title={title}>
      {children}
    </Drawer>
  ) : (
    <Dialog open={open} onClose={onClose} aria-label={title} title={title} size="md">
      {children}
    </Dialog>
  );
}
