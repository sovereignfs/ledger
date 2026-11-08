'use client';

import { useEffect, useState } from 'react';
import { type ThemeChoice, chooseTheme, readTheme } from '../theme/preferences';
import { SegmentedControl } from '@sovereignfs/ui';
import styles from './Account.module.css';

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Settings, Preferences (DESIGN.md §15.1): the theme, which is about this screen and so is kept on this device and applied at once. What arranges a person's
 * budget (the first day of the week, the number format) is the book's, and joins the Book section (task 9.3). What is chosen is read once
 * the page is in the browser, so the server draws the default first.
 */
export function PreferencesSection() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  useEffect(() => {
    setTheme(readTheme(storage()));
  }, []);
  return (
    <div className={styles.group}>
      <h2>Appearance</h2>
      <div className={styles.fit}>
        <SegmentedControl<ThemeChoice>
          aria-label="Theme"
          value={theme}
          onChange={(next) => {
            setTheme(next);
            chooseTheme(
              next,
              document.documentElement,
              window.matchMedia('(prefers-color-scheme: dark)').matches,
              storage(),
            );
          }}
          options={[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
        />
      </div>
      <p className={styles.hint}>Applies at once, on this device.</p>
      <h2>Install</h2>
      <p>
        Ledger can be installed as an app from your browser. In Chrome or Edge, use the install
        button in the address bar. On an iPhone or iPad, open Ledger in Safari, tap Share, then Add
        to Home Screen.
      </p>
    </div>
  );
}
