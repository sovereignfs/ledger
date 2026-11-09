const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * What to tell a person whose entry is dated in another month than the one they are in (DESIGN.md §14.4): "This counts towards October 2026." Empty for the
 * same month, and for a date that is not one. Pure: both days are given.
 */
export function monthNote(date: string, today: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  const here = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!match || !here) return '';
  const [year, month] = [Number(match[1]), Number(match[2])];
  if (year === Number(here[1]) && month === Number(here[2])) return '';
  const name = MONTHS[month - 1];
  return name ? `This counts towards ${name} ${year}.` : '';
}
