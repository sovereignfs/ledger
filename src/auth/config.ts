import type { Problem } from '../config';

/**
 * How people sign in (DESIGN.md §13.1), checked once at start-up with the other settings (`src/config/index.ts`), which is why this reads through
 * a function it is given and not the environment. A wrong setting is a problem that stops the server, and no message carries a value.
 *
 *   LEDGER_AUTH_LOCAL                 1 or true: email and password. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404.
 *   LEDGER_AUTH_SECRET[_FILE]         32 characters or more, to sign sessions and tokens. Required with local sign-in.
 *   LEDGER_AUTH_SIGNUP                `closed` (the default with local sign-in): the first account is made and then sign-up is refused, by the
 *                                      server. `open`: anyone who can reach the page. A self-hoster who forgets is not an open registration.
 *   LEDGER_AUTH_PASSWORD_MIN_LENGTH   the shortest password, 10 by default.
 *   LEDGER_URL                        the address people use; required (links, cookies and passkeys are made from it).
 *
 * Sign-in through a Sovereign core (`LEDGER_CORE_*`) joins with task 2.3. With the way off there is no sign-in at all, and the other settings here are
 * not read.
 */
export interface AuthSettings {
  /** The address people use, an origin with no path. */
  readonly url: string;
  readonly secret: string;
  readonly signUp: 'open' | 'closed';
  readonly passwordMinLength: number;
  /** Email and password, passkeys and an authenticator app are on. Off means off: their pages and routes answer 404. */
  readonly local: boolean;
}

export const MIN_SECRET_LENGTH = 32;
const DEFAULT_PASSWORD_MIN_LENGTH = 10;
const LONGEST_MIN_PASSWORD = 128;

/** The code a refused sign-up carries, in the API's answer. */
export const SIGNUP_CLOSED = 'SIGNUP_CLOSED';

/** Reads a setting by name, as `loadConfig` does: a secret may be a file, and an empty value is no value. */
export type Read = (name: string) => string | undefined;

/**
 * `url` is `LEDGER_URL` once checked, and absent when it was not given or was wrong (which `loadConfig` has already reported). Returns the
 * settings, or `undefined` when sign-in is off; a wrong setting is pushed to `problems`.
 */
export function resolveAuth(
  read: Read,
  url: string | undefined,
  problems: Problem[],
): AuthSettings | undefined {
  const local = readFlag(read, 'LEDGER_AUTH_LOCAL', problems);
  if (!local) return undefined;
  const why = 'LEDGER_AUTH_LOCAL is on';

  if (url === undefined && read('LEDGER_URL') === undefined) {
    problems.push(
      `${why}, so LEDGER_URL (the address people use) is required: links, cookies and the sign-in redirect are made from it.`,
    );
  }

  const secret = read('LEDGER_AUTH_SECRET');
  if (secret === undefined) {
    problems.push(`${why}, so LEDGER_AUTH_SECRET (or LEDGER_AUTH_SECRET_FILE) is required.`);
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `LEDGER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -base64 48 makes one).`,
    );
  }

  // Unset, it is closed. (With a core as the only way in it will be open, task 2.3: the core already decides who may sign in.)
  const rawSignUp = (read('LEDGER_AUTH_SIGNUP') ?? '').toLowerCase() || 'closed';
  if (rawSignUp !== 'open' && rawSignUp !== 'closed') {
    problems.push('LEDGER_AUTH_SIGNUP is open or closed.');
  }

  const rawLength = read('LEDGER_AUTH_PASSWORD_MIN_LENGTH');
  let passwordMinLength = DEFAULT_PASSWORD_MIN_LENGTH;
  if (rawLength !== undefined) {
    const parsed = Number(rawLength);
    if (!Number.isInteger(parsed) || parsed < 8 || parsed > LONGEST_MIN_PASSWORD) {
      problems.push(
        `LEDGER_AUTH_PASSWORD_MIN_LENGTH is a whole number from 8 to ${LONGEST_MIN_PASSWORD}.`,
      );
    } else passwordMinLength = parsed;
  }

  if (url === undefined || secret === undefined) return undefined;
  if (secret.length < MIN_SECRET_LENGTH || (rawSignUp !== 'open' && rawSignUp !== 'closed')) {
    return undefined;
  }
  return { url, secret, signUp: rawSignUp, passwordMinLength, local };
}

/** A switch is 1 or true to be on, 0 or false (or nothing) to be off; anything else is a mistake and is not guessed at. */
function readFlag(read: Read, name: string, problems: Problem[]): boolean {
  const value = read(name)?.toLowerCase();
  if (value === undefined || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  problems.push(`${name} is 1 or 0.`);
  return false;
}
