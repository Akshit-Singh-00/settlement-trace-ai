import { describe, expect, it } from 'vitest';
import { CsvValidationError, parseSyntheticCsv } from './csv-import';

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

  it('reports duplicate IDs with row-level feedback', () => {
    const csv = [
      'transaction_id,merchant_id,merchant_name,amount,currency,status,gateway_reference,captured_at,expected_settlement_minutes',
      'TXN-5000,MRC-500,Example,120000,INR,captured,GTW-5000,2026-09-04T10:00:00Z,120',
      'TXN-5000,MRC-501,Duplicate,100,INR,captured,GTW-5001,2026-09-04T10:02:00Z,120',
    ].join('\n');
    expect(() => parseSyntheticCsv('gateway', csv)).toThrow('Row 3: duplicate transaction_id TXN-5000');
  });

  it('rejects invalid settlement IDs and timestamps without crashing', () => {
    const csv = [
      'bank_reference,settlement_id,transaction_id,amount,status,credited_at',
      'BNK-1,WRONG-1,TXN-5000,100,credited,2026-09-04T10:00:00Z',
    ].join('\n');
    try {
      parseSyntheticCsv('bank', csv);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvValidationError);
      expect((error as CsvValidationError).issues[0]).toContain('settlement_id');
    }
  });
});
