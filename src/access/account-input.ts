import {
  isAccountType,
  type AccountPatch,
  type LoanTerms,
  type NewAccount,
} from '../ledger/account-types';

/**
 * What a request says about an account, read from JSON that anyone may send (DESIGN.md §5.2): **a type is checked before it is trusted**, a field that is
 * the wrong type is a refusal in a sentence, and an unknown field is ignored and never copied. The values are then checked again where they are written
 * (`src/ledger/account-types.ts`), so a caller other than a route gets the same answer. Whose account it is, is never in the body.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const optionalText = (value: unknown): string | null | undefined =>
  value === undefined || value === null ? (value as null | undefined) : text(value);
const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

function loanOf(value: unknown): Parsed<LoanTerms> {
  if (!isObject(value)) return { ok: false, problems: ['The loan terms are not a set of terms.'] };
  const lender = text(value.lender);
  const principal = whole(value.principal);
  const instalment = whole(value.instalment);
  const startDate = text(value.startDate);
  const endDate = text(value.endDate);
  const yearlyRate = value.yearlyRate == null ? null : text(value.yearlyRate);
  const interest = value.interestSubcategoryId == null ? null : text(value.interestSubcategoryId);
  if (
    lender === undefined ||
    principal === undefined ||
    instalment === undefined ||
    startDate === undefined ||
    endDate === undefined ||
    yearlyRate === undefined ||
    interest === undefined
  )
    return { ok: false, problems: ['The loan terms are not complete.'] };
  return {
    ok: true,
    value: {
      lender,
      principal,
      startDate,
      endDate,
      instalment,
      yearlyRate,
      interestSubcategoryId: interest,
    },
  };
}

/** The body of making an account. */
export function parseNewAccount(body: unknown): Parsed<NewAccount> {
  if (!isObject(body)) return { ok: false, problems: ['The request is not an account.'] };
  const { type, name, currency } = body;
  if (!isAccountType(type))
    return { ok: false, problems: ['The kind of account is not one there is.'] };
  const institution = optionalText(body.institution);
  if (
    typeof name !== 'string' ||
    typeof currency !== 'string' ||
    (institution === undefined && body.institution !== undefined)
  )
    return { ok: false, problems: ['The name, the currency and the institution are text.'] };
  const creditLimit = body.creditLimit == null ? null : whole(body.creditLimit);
  if (creditLimit === undefined) return { ok: false, problems: ['The limit is not an amount.'] };
  let opening: NewAccount['opening'] = null;
  if (body.opening != null) {
    if (!isObject(body.opening))
      return { ok: false, problems: ['The opening balance is not one.'] };
    const amount = whole(body.opening.amount);
    const date = text(body.opening.date);
    if (amount === undefined || date === undefined)
      return { ok: false, problems: ['The opening balance needs an amount and a day.'] };
    opening = { amount, date };
  }
  let loan: LoanTerms | null = null;
  if (body.loan != null) {
    const parsed = loanOf(body.loan);
    if (!parsed.ok) return parsed;
    loan = parsed.value;
  }
  return {
    ok: true,
    value: { type, name, institution: institution ?? null, currency, creditLimit, opening, loan },
  };
}

/** The body of changing an account: only what is given is changed. `archived` is read apart, by the route. */
export function parseAccountPatch(
  body: unknown,
): Parsed<{ patch: AccountPatch; archived?: boolean }> {
  if (!isObject(body)) return { ok: false, problems: ['The request is not a change.'] };
  const patch: { -readonly [K in keyof AccountPatch]: AccountPatch[K] } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return { ok: false, problems: ['The name is text.'] };
    patch.name = body.name;
  }
  if (body.institution !== undefined) {
    const institution = optionalText(body.institution);
    if (institution === undefined) return { ok: false, problems: ['The institution is text.'] };
    patch.institution = institution;
  }
  if (body.creditLimit !== undefined) {
    const limit = body.creditLimit === null ? null : whole(body.creditLimit);
    if (limit === undefined) return { ok: false, problems: ['The limit is not an amount.'] };
    patch.creditLimit = limit;
  }
  if (body.loan !== undefined) {
    if (!isObject(body.loan))
      return { ok: false, problems: ['The loan terms are not a set of terms.'] };
    const terms: {
      -readonly [K in keyof NonNullable<AccountPatch['loan']>]: NonNullable<
        AccountPatch['loan']
      >[K];
    } = {};
    if (body.loan.lender !== undefined) {
      if (typeof body.loan.lender !== 'string')
        return { ok: false, problems: ['The lender is text.'] };
      terms.lender = body.loan.lender;
    }
    if (body.loan.endDate !== undefined) {
      if (typeof body.loan.endDate !== 'string')
        return { ok: false, problems: ['The end of a loan is a day.'] };
      terms.endDate = body.loan.endDate;
    }
    if (body.loan.instalment !== undefined) {
      const instalment = whole(body.loan.instalment);
      if (instalment === undefined)
        return { ok: false, problems: ['The instalment is not an amount.'] };
      terms.instalment = instalment;
    }
    if (body.loan.yearlyRate !== undefined) {
      const rate = body.loan.yearlyRate === null ? null : text(body.loan.yearlyRate);
      if (rate === undefined)
        return { ok: false, problems: ['The yearly rate is text, such as 4.25.'] };
      terms.yearlyRate = rate;
    }
    patch.loan = terms;
  }
  if (body.archived !== undefined && typeof body.archived !== 'boolean')
    return { ok: false, problems: ['Archived is yes or no.'] };
  if (Object.keys(patch).length === 0 && body.archived === undefined)
    return { ok: false, problems: ['There is nothing to change.'] };
  return {
    ok: true,
    value: { patch, ...(typeof body.archived === 'boolean' ? { archived: body.archived } : {}) },
  };
}
