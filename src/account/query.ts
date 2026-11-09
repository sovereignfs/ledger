/**
 * Which part of Settings an address asks for (DESIGN.md §15.1): `/account?section=security`. Pure, so that what a stray or hostile address does is tested
 * with no browser. Only sections that exist can be asked for; an address that names another, or nothing, opens Profile.
 */
export const SECTIONS = [
  'profile',
  'security',
  'preferences',
  'book',
  'currencies',
  'budget',
  'notifications',
  'data',
] as const;
export type AccountSection = (typeof SECTIONS)[number];

export interface AccountQuery {
  section?: string | undefined;
}

export function sectionOf(query: AccountQuery): AccountSection {
  const asked = query.section;
  return (SECTIONS as readonly string[]).includes(asked ?? '')
    ? (asked as AccountSection)
    : 'profile';
}

/** The first value of a search parameter, which is all one of ours is. */
export const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;
