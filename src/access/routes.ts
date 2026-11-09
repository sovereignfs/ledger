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
  { route: '/api/entry-options', methods: { GET: { kind: 'book' } } },
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
