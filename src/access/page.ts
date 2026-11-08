import { getDatabase } from '../db/boot';
import { requireSession } from '../auth/session';
import { type Book, ensureBook } from '../ledger/books';

/**
 * For a page or server action that is only for someone signed in (DESIGN.md §5.2): **the account id and the person's book**. It sends a visitor to sign in,
 * answers 404 where there is no sign-in at all, and makes the book if this is the person's first request. Every page that has something of a person in it
 * calls it itself, whatever its layout does: a layout is not the only thing standing in the way (`routes.test.ts` holds each page to it).
 */
export async function requireBook(): Promise<{ accountId: string; book: Book }> {
  const session = await requireSession();
  const book = await ensureBook(await getDatabase(), session.user.id);
  return { accountId: session.user.id, book };
}
