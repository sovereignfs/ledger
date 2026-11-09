/**
 * Every page and route of the app, and who may use it (DESIGN.md §5.2). A route that is not here, or is here with a method it does not have, fails
 * `routes.test.ts`, so that a new endpoint cannot be added without saying who may call it, and a decision in this table cannot outlive the route.
 *
 *  - `public`: anyone, signed in or not. It shows nothing that belongs to a book. A public route that changes something says what stands in for a
 *    session in `because`, and the test refuses one that does not.
 *  - `book`: a signed-in account, and only the rows of its own book. A page asks `requireBook()`; a route is wrapped in `bookRoute` (`route.ts`),
 *    which finds the session, checks `Origin` on a write and hands over the account's id and its book's. The test holds both to it.
 *
 * Whether a person may touch a row is not decided here: it is a condition of the statement that touches it (`inBook`, `book.ts`).
 */
export type RouteAccess = { kind: 'public'; because?: string } | { kind: 'book' };

export interface RouteRule {
  /** The route as the app router spells it: `/api/accounts/[id]`. */
  route: string;
  /** For an API route, each method it answers. A page has none. */
  methods?: Record<string, RouteAccess>;
  /** For a page. */
  page?: RouteAccess;
}

export const ROUTES: RouteRule[] = [
  // Pages
  // The front address (DESIGN.md §14.3): the landing page for a visitor, and Overview for someone with a session cookie, which the proxy shows here by
  // rewriting to `/home`: the address stays `/`, and `/home` itself is sent back to it.
  { route: '/', page: { kind: 'public' } },
  { route: '/home', page: { kind: 'book' } },
  // Setup (DESIGN.md §15.3): full-bleed, outside the shell, for someone signed in; the front address sends a book that is not set up here.
  { route: '/setup', page: { kind: 'book' } },
  { route: '/sign-in', page: { kind: 'public' } },
  { route: '/sign-up', page: { kind: 'public' } },
  // Only with mail (DESIGN.md §13.1): without it they are 404, like the routes under /api/auth that send and use the links.
  { route: '/forgot-password', page: { kind: 'public' } },
  { route: '/reset-password', page: { kind: 'public' } },
  // Settings (DESIGN.md §15.1): a page of its own, and a dialog over another page by an intercepting route at the same address.
  { route: '/account', page: { kind: 'book' } },
  // The places of the app (DESIGN.md §14.3), for someone signed in.
  { route: '/transactions', page: { kind: 'book' } },
  { route: '/budget', page: { kind: 'book' } },
  { route: '/budget/categories', page: { kind: 'book' } },
  { route: '/budget/income', page: { kind: 'book' } },
  { route: '/budget/bills', page: { kind: 'book' } },
  { route: '/payees', page: { kind: 'book' } },
  { route: '/payees/[id]', page: { kind: 'book' } },
  { route: '/accounts', page: { kind: 'book' } },
  { route: '/accounts/[id]', page: { kind: 'book' } },
  { route: '/reports', page: { kind: 'book' } },

  // APIs
  // Deleting the account (DESIGN.md §17): what it would do, and doing it with the password; the account is the session's.
  {
    route: '/api/account/delete',
    methods: { GET: { kind: 'book' }, POST: { kind: 'book' } },
  },
  // Money accounts (DESIGN.md §6.1): the person's own, in the person's own book. Nothing in a request names whose.
  { route: '/api/accounts', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  {
    route: '/api/accounts/[id]',
    methods: { GET: { kind: 'book' }, PATCH: { kind: 'book' }, DELETE: { kind: 'book' } },
  },
  {
    route: '/api/accounts/[id]/reconcile',
    methods: { GET: { kind: 'book' }, POST: { kind: 'book' } },
  },
  { route: '/api/accounts/[id]/value', methods: { POST: { kind: 'book' } } },
  // A loan's instalment as a recurring entry (DESIGN.md §8.3): the loan is the person's own.
  { route: '/api/accounts/[id]/instalments', methods: { POST: { kind: 'book' } } },
  // Budgeted amounts with their history (DESIGN.md §7.3): the person's own. Nothing in a request names whose, or which month is "this" one.
  { route: '/api/budget', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  // Income sources and a month's income (DESIGN.md §7.4): the person's own. Nothing in a request names whose.
  { route: '/api/income-sources', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  {
    route: '/api/income-sources/[id]',
    methods: { PATCH: { kind: 'book' }, DELETE: { kind: 'book' } },
  },
  { route: '/api/income', methods: { GET: { kind: 'book' } } },
  // The setup wizard (DESIGN.md §15.3): each step a write in the person's own book, safe to repeat.
  { route: '/api/setup', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  // Categories and subcategories (DESIGN.md §7.1): the person's own. Nothing in a request names whose.
  {
    route: '/api/categories',
    methods: { GET: { kind: 'book' }, POST: { kind: 'book' }, PUT: { kind: 'book' } },
  },
  { route: '/api/categories/[id]', methods: { PATCH: { kind: 'book' }, DELETE: { kind: 'book' } } },
  { route: '/api/categories/[id]/subcategories', methods: { POST: { kind: 'book' } } },
  {
    route: '/api/subcategories/[id]',
    methods: { PATCH: { kind: 'book' }, DELETE: { kind: 'book' } },
  },
  // Entries (DESIGN.md §6.2, §14.4): written, read and changed in the person's own book. Nothing in a request names whose.
  { route: '/api/transactions', methods: { POST: { kind: 'book' } } },
  {
    route: '/api/transactions/[id]',
    methods: { GET: { kind: 'book' }, PATCH: { kind: 'book' }, DELETE: { kind: 'book' } },
  },
  { route: '/api/transactions/bulk', methods: { POST: { kind: 'book' } } },
  { route: '/api/entry-options', methods: { GET: { kind: 'book' } } },
  // Payees (DESIGN.md §6.5): the person's own. Nothing in a request names whose.
  { route: '/api/payees', methods: { GET: { kind: 'book' } } },
  { route: '/api/payees/[id]', methods: { GET: { kind: 'book' }, PATCH: { kind: 'book' } } },
  // Recurring entries (DESIGN.md §8): the person's own. Nothing in a request names whose.
  { route: '/api/recurring', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  { route: '/api/recurring/[id]', methods: { PATCH: { kind: 'book' }, DELETE: { kind: 'book' } } },
  { route: '/api/recurring/[id]/post', methods: { POST: { kind: 'book' } } },
  { route: '/api/recurring/[id]/skip', methods: { POST: { kind: 'book' } } },
  { route: '/api/upcoming', methods: { GET: { kind: 'book' } } },
  // Saving jars (DESIGN.md §10): the person's own. Nothing in a request names whose.
  { route: '/api/jars', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  { route: '/api/jars/[id]', methods: { PATCH: { kind: 'book' } } },
  { route: '/api/jars/[id]/movements', methods: { POST: { kind: 'book' } } },
  // The book's settings (DESIGN.md §15.1): the person's own book. Nothing in a request names whose.
  { route: '/api/book', methods: { GET: { kind: 'book' }, PATCH: { kind: 'book' } } },
  { route: '/api/book/currencies', methods: { POST: { kind: 'book' } } },
  // The month-end review (DESIGN.md §11.4): the person's own book's. Nothing in a request names whose.
  { route: '/api/reviews', methods: { GET: { kind: 'book' }, POST: { kind: 'book' } } },
  // The instance asks it before it sends anyone to the app, and a container's health check does: it says only whether the database answers.
  { route: '/api/health', methods: { GET: { kind: 'public' } } },
  // better-auth's own: it checks `Origin` and the session cookie itself, and rate-limits sign-in (src/auth/auth.ts). Absent, with a 404, when sign-in is off.
  {
    route: '/api/auth/[...all]',
    methods: {
      GET: { kind: 'public' },
      POST: {
        kind: 'public',
        because: 'better-auth checks Origin, the session cookie and the rate limit',
      },
    },
  },
];
