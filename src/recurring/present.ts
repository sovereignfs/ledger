import type { Template } from './recurring';

/**
 * What a recurring entry shows on a list (DESIGN.md §8): its amount and the currency it is in, from the template's lines, **pure** so the bills page and the
 * tests have one reading. An expense is what reaches its subcategories, an income what leaves its sources, a transfer what reaches the account it goes to.
 */
export function amountOf(template: Template): { amount: number; currency: string } {
  const lines = template.lines;
  const sum = (picked: typeof lines) => picked.reduce((total, line) => total + line.amount, 0);
  const pick =
    template.type === 'expense'
      ? lines.filter((line) => line.subcategory !== undefined)
      : template.type === 'income'
        ? lines.filter((line) => line.incomeSource !== undefined)
        : lines.filter((line) => line.amount > 0);
  const currency = (pick[0] ?? lines[0])?.currency ?? 'USD';
  return { amount: Math.abs(sum(pick)), currency };
}
