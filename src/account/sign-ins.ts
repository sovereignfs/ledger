import { getAuth } from '../auth/server';

/** How an account can sign in (DESIGN.md §13.1, §15.1): with a password now, and through Sovereign too once that is built (task 2.3). Read from the sign-in store, for the Security section. */
export interface SignIns {
  /** It has a password (and so can have an authenticator app and passkeys). */
  hasPassword: boolean;
}

export async function signInsOf(accountId: string): Promise<SignIns> {
  const auth = await getAuth();
  if (!auth) return { hasPassword: false };
  const context = await auth.$context;
  const accounts = await context.internalAdapter.findAccounts(accountId);
  return { hasPassword: accounts.some((account) => account.providerId === 'credential') };
}
