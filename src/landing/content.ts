/**
 * What the landing page says (DESIGN.md §1), as typed content so that it is read in one place and cannot be half-edited. It says what is so today and
 * nothing that is only planned: a page that promises what the app does not do is worse than a short one. Each task that builds something a visitor would
 * want to know about adds a line here, and `content.test.ts` keeps the words of what is not built out until it is.
 */
export interface Feature {
  title: string;
  body: string;
}

export const landing = {
  heading: 'Your money, kept on a server of your own',
  lead: 'Ledger is a personal budget and net-worth app. It is being built, and runs on a server you control: nothing of it goes anywhere else.',
  signIn: 'Sign in',
  signUp: 'Create an account',
  noSignIn: 'Signing in is not set up on this server.',
  features: [
    {
      title: 'Yours alone',
      body: 'What you enter is seen by you and no one else, on a server you chose.',
    },
    {
      title: 'Signing in',
      body: 'A password, a passkey or an authenticator app, as you prefer.',
    },
    {
      title: 'On a phone or a desktop',
      body: 'The same places at the same addresses at every width, in light or dark.',
    },
  ] satisfies Feature[],
} as const;
