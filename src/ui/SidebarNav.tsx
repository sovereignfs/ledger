'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, NavList } from '@sovereignfs/ui';
import { PLACES, placeOf } from './nav';
import styles from './AppShell.module.css';

/**
 * The sidebar of a wide screen (DESIGN.md §14.2): **Add**, pinned above the five places, which are links (`next/link`) with the current one marked.
 * Add is not wired until the add dialog exists (task 4.3); it is drawn disabled until then, so that the frame is the one the design describes.
 */
export function SidebarNav() {
  const current = placeOf(usePathname())?.id;
  return (
    <nav className={styles.sidebar} aria-label="Main">
      <Button variant="primary" disabled title="Adding arrives with the add dialog">
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
