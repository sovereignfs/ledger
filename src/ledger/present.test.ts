import { describe, expect, it } from 'vitest';
import { cardAvailable, cardUsed, loanProgress, sayBalance } from './present';

describe('saying a balance', () => {
  it('never shows a minus for money that is owed: it uses words', () => {
    for (const [type, balance] of [
      ['credit_card', -42000],
      ['loan', -1000000],
      ['person', -500],
      ['bank', -5000],
    ] as const) {
      const said = sayBalance(type, balance, 'USD', 'en-US');
      expect(said.text, `${type}`).not.toMatch(/[-−–]/);
      expect(said.tone).toBe('owed');
    }
    expect(sayBalance('credit_card', -42000, 'USD', 'en-US').text).toBe('$420.00 used');
    expect(sayBalance('loan', -1000000, 'USD', 'en-US').text).toBe('$10,000.00 left to pay');
    expect(sayBalance('person', -500, 'USD', 'en-US').text).toBe('You owe $5.00');
    expect(sayBalance('bank', -5000, 'USD', 'en-US').text).toBe('$50.00 overdrawn');
  });

  it('says what is owed to the person, and what is simply held', () => {
    expect(sayBalance('person', 500, 'USD', 'en-US')).toEqual({
      text: 'Owes you $5.00',
      tone: 'owes_you',
    });
    expect(sayBalance('bank', 123456, 'EUR', 'en-US')).toEqual({
      text: '€1,234.56',
      tone: 'normal',
    });
    expect(sayBalance('cash', 0, 'USD', 'en-US').text).toBe('$0.00');
    expect(sayBalance('person', 0, 'USD', 'en-US').text).toBe('Settled');
    expect(sayBalance('loan', 0, 'USD', 'en-US').text).toBe('Paid off');
    expect(sayBalance('credit_card', 0, 'USD', 'en-US').text).toBe('Nothing owed');
    expect(sayBalance('credit_card', 300, 'USD', 'en-US').text).toBe('$3.00 in credit');
  });

  it('uses the currency’s own decimals', () => {
    expect(sayBalance('bank', 1500, 'JPY', 'en-US').text).toBe('¥1,500');
    // Intl puts a no-break space between a code and its number.
    expect(sayBalance('credit_card', -1005, 'BHD', 'en-US').text.replace(/\u00a0/g, ' ')).toBe(
      'BHD 1.005 used',
    );
  });
});

describe('a card and a loan', () => {
  it('shows what of the limit is used and what is left, never below nothing', () => {
    expect(cardUsed(-42000)).toBe(42000);
    expect(cardAvailable(500000, -42000)).toBe(458000);
    expect(cardUsed(300)).toBe(0);
    expect(cardAvailable(500000, 300)).toBe(500300);
    expect(cardAvailable(1000, -5000)).toBe(0);
  });

  it('shows what is left of a loan and what has been paid, within the principal', () => {
    expect(loanProgress(1000000, -1000000)).toEqual({ left: 1000000, paid: 0 });
    expect(loanProgress(1000000, -250000)).toEqual({ left: 250000, paid: 750000 });
    expect(loanProgress(1000000, 0)).toEqual({ left: 0, paid: 1000000 });
    expect(loanProgress(1000000, 5000)).toEqual({ left: 0, paid: 1000000 });
    expect(loanProgress(1000000, -1200000)).toEqual({ left: 1200000, paid: 0 });
  });
});
