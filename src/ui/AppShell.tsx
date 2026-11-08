import type { ReactNode } from 'react';
import { PhoneNav } from './PhoneNav';
import { SidebarNav } from './SidebarNav';
import styles from './AppShell.module.css';

/**
 * The frame of a signed-in page (DESIGN.md §14.2): a header row, with the app's wordmark, _ledger._, on the left and the person's avatar menu on the right,
 * and under it the sidebar and the main area on a wide screen, or the main area and the footer on a phone. The two navigations are both drawn and the
 * stylesheet shows one, so the choice is made by the browser's width and no code asks for it (DESIGN.md §14.6).
 *
 * It is made here, and not with the design system's `Header`, because that header always draws a brand badge, an initial on the accent colour, where
 * Ledger's has only its wordmark. **Worth offering to `@sovereignfs/ui`:** a `Header` whose brand can be the app's own mark; then this row is that
 * `Header`.
 *
 * The avatar menu is given, because what it does (open Settings, sign out) is the auth client's, which this component does not know (tasks 2.1, 2.6).
 */
export function AppShell({
  name,
  account,
  nav = true,
  children,
}: {
  /** The app's name, which a screen reader says in place of the wordmark. */
  name: string;
  /** The person's avatar menu, at the right of the header. */
  account?: ReactNode;
  /** Whether the places are drawn: not on a page that has none, such as the one that is not found for someone who is signed out. */
  nav?: boolean;
  children: ReactNode;
}) {
  return (
    // `sv-app-shell` is where the design system's footer publishes its height (`--sv-shell-footer-height`), so that sheets and dialogs clear it.
    <div id="sv-app-shell" className={styles.shell}>
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label={name}>
          <span className={styles.wordmark} aria-hidden>
            ledger.
          </span>
        </a>
        <div className={styles.actions}>{account}</div>
      </header>
      <div className={styles.body}>
        {nav ? <SidebarNav /> : null}
        <main className={styles.main}>{children}</main>
      </div>
      {nav ? (
        <footer className={styles.footer}>
          <PhoneNav />
        </footer>
      ) : null}
    </div>
  );
}
