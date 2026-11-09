'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, NavList } from '@sovereignfs/ui';
import { useEntryDialog } from '../entries/EntryProvider';
import { PLACES, placeOf } from './nav';
import styles from './AppShell.module.css';

/**
 * The sidebar of a wide screen (DESIGN.md §14.2): **Add**, pinned above the five places, which are links (`next/link`) with the current one marked.
 * Add opens the add dialog (task 4.3) from whichever page the person is on.
 */
export function SidebarNav() {
  const current = placeOf(usePathname())?.id;
  const { openAdd } = useEntryDialog();
  return (
    <nav className={styles.sidebar} aria-label="Main">
      <Button variant="primary" onClick={openAdd}>
        Add
      </Button>
      <NavList
        aria-label="Places"
        variant="static"
        groups={[
          {
            id: 'places',
            items: PLACES.map((place) => ({ ...place, active: place.id === current })),
          },
        ]}
        renderLink={(item, linkProps) => (
          <Link {...linkProps} href={item.href}>
            {linkProps.children}
          </Link>
        )}
      />
    </nav>
  );
}
