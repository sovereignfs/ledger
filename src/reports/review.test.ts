import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { ensureBook, findBook, type Book } from '../ledger/books';
import { seedAccount, seedIncomeSource } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import {
  loadReviewBanner,
  monthNeedingReview,
  pastMonths,
  reviewStatus,
  reviewedMonths,
  setReviewed,
} from './review';

const { leg } = testTarget();

describe('the status of a month (pure)', () => {
  const reviewed = new Set(['2026-09']);
  it('is in progress for this month and any after, reviewed for a month marked, and needs review for any other past one', () => {
    expect(reviewStatus('2026-11', '2026-11', reviewed)).toBe('in_progress');
    expect(reviewStatus('2026-12', '2026-11', reviewed)).toBe('in_progress');
    expect(reviewStatus('2026-09', '2026-11', reviewed)).toBe('reviewed');
    expect(reviewStatus('2026-10', '2026-11', reviewed)).toBe('needs_review');
  });

  it('lists the past months from the first entry, newest first, and none for a book that has not been through a month', () => {
    expect(pastMonths('2026-08', '2026-11')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(pastMonths('2026-11', '2026-11')).toEqual([]);
    expect(pastMonths(null, '2026-11')).toEqual([]);
    expect(pastMonths('2025-12', '2026-02')).toEqual(['2026-01', '2025-12']);
  });

  it('is the most recent past month not reviewed, which moves back as they are, and none when all are', () => {
    expect(monthNeedingReview('2026-08', '2026-11', new Set())).toBe('2026-10');
    expect(monthNeedingReview('2026-08', '2026-11', new Set(['2026-10']))).toBe('2026-09');
    expect(
      monthNeedingReview('2026-08', '2026-11', new Set(['2026-10', '2026-09', '2026-08'])),
    ).toBeNull();
    expect(monthNeedingReview(null, '2026-11', new Set())).toBeNull();
  });
});

let t: TwoAccounts;
let adas: Book;
const TODAY = '2026-11-09';
const NOW = new Date(`${TODAY}T12:00:00Z`);
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  adas = (await findBook(t.database, t.ada.id)) as Book;
});
afterAll(async () => t.close());

const rows = async (bookId: string) =>
  dbAll<{ month: string }>(
    t.database,
    (await import('drizzle-orm'))
      .sql`SELECT month AS month FROM ${tableNamed(t.database, 'month_review')} WHERE book_id = ${bookId} ORDER BY month`,
  );

describe(`marking a month reviewed (${leg})`, () => {
  it('marks a past month, once however many times, and undoes it', async () => {
    expect(await setReviewed(t.database, t.ada.id, adas.id, '2026-10', true, TODAY)).toEqual({
      ok: true,
      id: '2026-10',
    });
    expect(await setReviewed(t.database, t.ada.id, adas.id, '2026-10', true, TODAY)).toEqual({
      ok: true,
      id: '2026-10',
    });
    expect((await rows(adas.id)).map((r) => r.month)).toEqual(['2026-10']);
    expect([...(await reviewedMonths(t.database, t.ada.id, adas.id))]).toEqual(['2026-10']);
    expect(await setReviewed(t.database, t.ada.id, adas.id, '2026-10', false, TODAY)).toEqual({
      ok: true,
      id: '2026-10',
    });
    expect(await setReviewed(t.database, t.ada.id, adas.id, '2026-10', false, TODAY)).toEqual({
      ok: true,
      id: '2026-10',
    });
    expect(await rows(adas.id)).toEqual([]);
  });

  it('refuses a month that is not over, and a month that is not one, in sentences, writing nothing', async () => {
    for (const month of ['2026-11', '2026-12', '2031-01', 'soon', '2026-13', '']) {
      const refused = await setReviewed(t.database, t.ada.id, adas.id, month, true, TODAY);
      expect(refused, month).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(await rows(adas.id)).toEqual([]);
  });

  it('is the book’s own: another person marks and reads nothing of it, and it reads as a book that is not there', async () => {
    expect(await setReviewed(t.database, t.grace.id, adas.id, '2026-09', true, TODAY)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    await setReviewed(t.database, t.ada.id, adas.id, '2026-09', true, TODAY);
    expect(await setReviewed(t.database, t.grace.id, adas.id, '2026-09', false, TODAY)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect((await reviewedMonths(t.database, t.grace.id, adas.id)).size).toBe(0);
    expect((await rows(adas.id)).map((r) => r.month)).toEqual(['2026-09']);
    await setReviewed(t.database, t.ada.id, adas.id, '2026-09', false, TODAY);
  });
});

describe(`the banner of Overview (${leg})`, () => {
  it('is for the most recent past month that needs review, is gone when it is reviewed, and returns when that is undone', async () => {
    expect(await loadReviewBanner(t.database, t.ada.id, adas, NOW)).toBeNull();
    const bank = await seedAccount(t.database, adas.id, 'USD');
    const pay = await seedIncomeSource(t.database, adas.id);
    await createTransaction(t.database, t.ada.id, adas.id, {
      type: 'income',
      date: '2026-08-12',
      lines: [
        { account: bank, amount: 100, currency: 'USD' },
        { incomeSource: pay, amount: -100, currency: 'USD' },
      ],
    });
    expect(await loadReviewBanner(t.database, t.ada.id, adas, NOW)).toBe('2026-10');
    await setReviewed(t.database, t.ada.id, adas.id, '2026-10', true, TODAY);
    expect(await loadReviewBanner(t.database, t.ada.id, adas, NOW)).toBe('2026-09');
    await setReviewed(t.database, t.ada.id, adas.id, '2026-09', true, TODAY);
    await setReviewed(t.database, t.ada.id, adas.id, '2026-08', true, TODAY);
    expect(await loadReviewBanner(t.database, t.ada.id, adas, NOW)).toBeNull();
    // Undone: it returns.
    await setReviewed(t.database, t.ada.id, adas.id, '2026-10', false, TODAY);
    expect(await loadReviewBanner(t.database, t.ada.id, adas, NOW)).toBe('2026-10');
    // Another person's banner is of their own book.
    const hers = (await findBook(t.database, t.grace.id)) as Book;
    expect(await loadReviewBanner(t.database, t.grace.id, hers, NOW)).toBeNull();
  });
});
