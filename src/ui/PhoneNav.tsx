'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button, Drawer, Icon, MobileFooter, NavList } from '@sovereignfs/ui';
import { PLACES, placeOf } from './nav';
import styles from './AppShell.module.css';

/**
 * The phone's footer (DESIGN.md §14.6): four of the five places, two on each side of the middle button, which opens the rest in a drawer (Reports, and
 * Add until its dialog exists). **The same places at the same addresses as the sidebar**: only what is drawn differs, and the shell's CSS decides
 * at which width (`AppShell.module.css`), so nothing here asks for the width.
 */
export function PhoneNav() {
  const [more, setMore] = useState(false);
  const current = placeOf(usePathname())?.id;
  const icon = (id: (typeof PLACES)[number]['id']) => {
    const place = PLACES.find((each) => each.id === id);
    if (!place) throw new Error(`no such place: ${id}`);
    return {
      icon: <Icon name={place.icon} aria-hidden />,
      label: place.label,
      href: place.href,
      active: current === place.id,
    };
  };
  const reports = PLACES.find((place) => place.id === 'reports');
  return (
    <>
      <MobileFooter
        aria-label="Main"
        onOpenApps={() => setMore(true)}
        launcherOpen={more}
        launcherIcon={<Icon name="menu" aria-hidden />}
        leftIcons={[icon('overview'), icon('transactions')]}
        rightIcons={[icon('budget'), icon('accounts')]}
      />
      <Drawer open={more} onClose={() => setMore(false)} aria-label="More places">
        <div className={styles.more}>
          <Button variant="primary" disabled title="Adding arrives with the add dialog">
            Add
          </Button>
          {reports ? (
            <NavList
              aria-label="More places"
              variant="static"
              groups={[{ id: 'more', items: [{ ...reports, active: current === 'reports' }] }]}
              renderLink={(item, linkProps) => (
                <Link {...linkProps} href={item.href} onClick={() => setMore(false)}>
                  {linkProps.children}
                </Link>
              )}
            />
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
