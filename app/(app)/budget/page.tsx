import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { budgetHistory } from '@/src/budget/amounts';
import { BudgetScreen, type Selected } from '@/src/budget/BudgetScreen';
import { lastDayOf } from '@/src/budget/income';
import { loadBudget } from '@/src/budget/screen';
import { isMonth, monthOf, todayIn } from '@/src/dates';
import { getDatabase } from '@/src/db/boot';
import { listEntries } from '@/src/ledger/entry-list';
import { describeEntry } from '@/src/transactions/present';

export const metadata: Metadata = { title: 'Budget' };

/** Budget (DESIGN.md §7.2, §14.3): a month's budgeted and spent in Bills, Spending and Saving; `?month=YYYY-MM`, and `?row=<subcategory>` opens a row. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId, book } = await requireBook();
  const database = await getDatabase();
  const query = await searchParams;
  const asked = typeof query.month === 'string' ? query.month : undefined;
  const month = asked && isMonth(asked) ? asked : monthOf(todayIn(book.timeZone));
  const figures = await loadBudget(database, accountId, book, month);
  const rowId = typeof query.row === 'string' ? query.row : undefined;
  const line = rowId
    ? figures.groups.flatMap((group) => group.rows).find((each) => each.subcategory.id === rowId)
    : undefined;
  let selected: Selected | undefined;
  if (line) {
    const [history, entries] = await Promise.all([
      budgetHistory(database, accountId, book.id, 'subcategory', line.subcategory.id),
      listEntries(
        database,
        accountId,
        book.id,
        { subcategory: line.subcategory.id, from: `${month}-01`, to: lastDayOf(month) },
        undefined,
        100,
      ),
    ]);
    // Each entry shows what went to this subcategory, which for a split is its part and not the whole.
    selected = {
      line,
      history,
      entries: entries.entries.map((entry) => {
        const mine = entry.lines.filter((each) => each.subcategory?.id === line.subcategory.id);
        return {
          ...describeEntry(entry),
          amount: mine.reduce((sum, each) => sum + each.amount, 0),
          currency: mine[0]?.currency ?? line.category.currency,
        };
      }),
    };
  }
  return <BudgetScreen figures={figures} selected={selected} locale={book.locale ?? undefined} />;
}
