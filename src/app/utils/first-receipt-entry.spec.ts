import { rememberFirstReceiptEntry, takeFirstReceiptEntry } from './first-receipt-entry';

describe('first receipt entry after email verification', () => {
  const account = 'new-receipt-entry-test';

  afterEach(() => takeFirstReceiptEntry(account));

  it('opens upload once, only for the account that requested it', () => {
    rememberFirstReceiptEntry(account, 1000);
    expect(takeFirstReceiptEntry('another-account', 1100)).toBeFalse();
    expect(takeFirstReceiptEntry(account, 1200)).toBeTrue();
    expect(takeFirstReceiptEntry(account, 1300)).toBeFalse();
  });

  it('clears the request if the account is verified more than a week later', () => {
    rememberFirstReceiptEntry(account, 1000);
    expect(takeFirstReceiptEntry(account, 1000 + 8 * 86400000)).toBeFalse();
    expect(takeFirstReceiptEntry(account, 1100)).toBeFalse();
  });
});
