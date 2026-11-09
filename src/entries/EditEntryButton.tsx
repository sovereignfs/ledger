'use client';

import { Button } from '@sovereignfs/ui';
import { useEntryDialog } from './EntryProvider';

/** The button on an entry's row that opens it in the same dialog, to change or delete (DESIGN.md §14.4). */
export function EditEntryButton({ id, label }: { id: string; label: string }) {
  const { openEdit } = useEntryDialog();
  return (
    <Button variant="ghost" size="sm" aria-label={label} onClick={() => openEdit(id)}>
      Edit
    </Button>
  );
}
