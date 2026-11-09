/**
 * **The tables whose every row carries `book_id`** (DESIGN.md §18.3), apart from `book` and `book_member` themselves, which are the book's own. They are what
 * `People.deletePerson` deletes by `book_id` when a book goes with its only member, what export reads (task 11.1) and what import writes (task 11.2). A task
 * that makes such a table adds its name here **in the same change**, and `src/sovereign/people.test.ts` fails for a table of the app that is in neither this
 * list nor the one of tables that are not a book's: so a table that holds something of a person cannot be added and left out of their deletion.
 *
 * The order is the order of deletion: a table that points at another (by value, never a foreign key) is listed before the one it points at.
 */
export const BOOK_TABLES: readonly string[] = [
  'txn_line',
  'txn',
  'payee',
  'recurring_skip',
  'recurring',
  'budget_amount',
  'loan',
  'subcategory',
  'category',
  'income_source',
  'money_account',
  'book_currency',
];
