import { describe, expect, it } from 'vitest';
import { parseSyntheticCsv } from './csv-import';

describe('parseSyntheticCsv', () => {
  it('normalizes a valid gateway record', () => {
    const csv = [
      'transaction_id,merchant_id,merchant_name,amount,currency,status,gateway_reference,captured_at,expected_settlement_minutes',
      'txn-5000,MRC-500,Example Merchant,120000,INR,captured,GTW-5000,2026-09-04T10:00:00Z,120',
    ].join('\n');
    expect(parseSyntheticCsv('gateway', csv)[0]).toMatchObject({
      transactionId: 'TXN-5000',
      amount: 120000,
      currency: 'INR',
    });
  });

  it('rejects malformed input before changing application data', () => {
    expect(() => parseSyntheticCsv('bank', 'transaction_id,amount\nTXN-1,100')).toThrow('Missing required columns');
  });
});
