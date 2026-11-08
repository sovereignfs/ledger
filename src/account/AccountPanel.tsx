import { authSettings } from '../auth/server';
import { requireSession } from '../auth/session';
import { AccountShell } from './AccountShell';
import { DataSection } from './DataSection';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';
import { signInsOf } from './sign-ins';

/**
 * Settings, in one place (DESIGN.md §15.1), as a dialog over the page it was opened from or at an address of its own. The sections are server-rendered and
 * handed to the shell, which only shows the one that is open. The book's own sections (currencies, income sources, categories, payees, the recap) join
 * with task 9.3.
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { user } = await requireSession();
  const signIns = await signInsOf(user.id);
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: <ProfileSection name={user.name} email={user.email} />,
        security: (
          <SecuritySection
            passwordMinLength={authSettings()?.passwordMinLength ?? 10}
            hasPassword={signIns.hasPassword}
          />
        ),
        preferences: <PreferencesSection />,
        data: <DataSection />,
      }}
    />
  );
}
