import { authSettings } from '../auth/server';
import { requireSession } from '../auth/session';
import { requireBook } from '../access/page';
import { getDatabase } from '../db/boot';
import { listCurrencies } from '../ledger/currencies';
import { BookSection } from './BookSection';
import { BudgetSection } from './BudgetSection';
import { CurrenciesSection } from './CurrenciesSection';
import { NotificationsSection } from './NotificationsSection';
import { AccountShell } from './AccountShell';
import { DataSection } from './DataSection';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';
import { signInsOf } from './sign-ins';

/**
 * Settings, in one place (DESIGN.md §15.1), as a dialog over the page it was opened from or at an address of its own. The sections are server-rendered and
 * handed to the shell, which only shows the one that is open. The book's own sections (its settings, currencies, where the budget's parts are, the recap) are here too (task 9.3).
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { user } = await requireSession();
  const settings = authSettings();
  const { accountId, book } = await requireBook();
  const signIns = await signInsOf(user.id);
  const currencies = await listCurrencies(await getDatabase(), accountId, book.id);
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: <ProfileSection name={user.name} email={user.email} />,
        security: (
          <SecuritySection
            passwordMinLength={settings?.passwordMinLength ?? 10}
            hasPassword={signIns.hasPassword}
            sovereign={
              settings?.sovereign ? { linkedAccountId: signIns.sovereignAccountId } : undefined
            }
            email={user.email}
            result={{
              linked: query.linked === '1',
              unlinked: query.unlinked === '1',
              error: query.error ?? null,
            }}
          />
        ),
        preferences: <PreferencesSection />,
        book: (
          <BookSection
            name={book.name}
            baseCurrency={book.baseCurrency}
            timeZone={book.timeZone}
            firstDayOfWeek={book.firstDayOfWeek}
            locale={book.locale}
          />
        ),
        currencies: <CurrenciesSection codes={currencies} base={book.baseCurrency} />,
        budget: <BudgetSection />,
        notifications: <NotificationsSection recap={book.recap} />,
        data: <DataSection />,
      }}
    />
  );
}
