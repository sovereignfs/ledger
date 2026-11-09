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

/**
 * The template with a corrected amount, for a person who confirms a bill that came to something else (DESIGN.md §8.2): the two lines of a plain entry take the
 * new amount with the signs they had. An entry with more lines (a split), or with two currencies, is posted as it is and edited afterwards, so `undefined`.
 */
export function withAmount(template: Template, amount: number): Template | undefined {
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  const [first, second, ...rest] = template.lines;
  if (!first || !second || rest.length > 0 || first.currency !== second.currency) return undefined;
  if (Math.sign(first.amount) === Math.sign(second.amount)) return undefined;
  return {
    ...template,
    lines: [
      { ...first, amount: Math.sign(first.amount) * amount },
      { ...second, amount: Math.sign(second.amount) * amount },
    ],
  };
}
