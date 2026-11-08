import type { IconName } from '@sovereignfs/ui';

/** One place in the app, reached from the sidebar on a wide screen and the footer on a phone: the same addresses at every width (DESIGN.md §14.6). */
export interface Place {
  id: 'overview' | 'transactions' | 'budget' | 'accounts' | 'reports';
  label: string;
  href: string;
  icon: IconName;
}

export const PLACES: readonly Place[] = [
  { id: 'overview', label: 'Overview', href: '/', icon: 'house' },
  { id: 'transactions', label: 'Transactions', href: '/transactions', icon: 'list' },
  { id: 'budget', label: 'Budget', href: '/budget', icon: 'sliders-horizontal' },
  { id: 'accounts', label: 'Accounts', href: '/accounts', icon: 'credit-card' },
  { id: 'reports', label: 'Reports', href: '/reports', icon: 'activity' },
];

/**
 * The place a path is in, or none: a place and everything under it (`/accounts/<id>` is Accounts). Overview is `/` alone, since every address
 * starts with it. Pure, so that the rule is tested with no browser.
 */
export function placeOf(pathname: string): Place | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PLACES.find((place) =>
    place.href === '/' ? path === '/' : path === place.href || path.startsWith(`${place.href}/`),
  );
}
