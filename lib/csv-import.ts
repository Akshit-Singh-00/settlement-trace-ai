import Papa from 'papaparse';
import type { BankRecord, GatewayRecord, LedgerRecord, SettlementDataset } from './settlement-types';

export type CsvSource = 'gateway' | 'bank' | 'ledger';

type CsvRecordMap = {
  gateway: GatewayRecord;
  bank: BankRecord;
  ledger: LedgerRecord;
};

const requiredColumns: Record<CsvSource, string[]> = {
  gateway: ['transaction_id', 'merchant_id', 'merchant_name', 'amount', 'currency', 'status', 'gateway_reference', 'captured_at', 'expected_settlement_minutes'],
  bank: ['bank_reference', 'settlement_id', 'transaction_id', 'amount', 'status'],
  ledger: ['ledger_reference', 'settlement_id', 'transaction_id', 'amount', 'status', 'posted_at'],
};

function positiveNumber(value: string, field: string, row: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Row ${row}: ${field} must be a non-negative number.`);
  return parsed;
}

function validDate(value: string | undefined, field: string, row: number, optional = false) {
  if (!value && optional) return undefined;
  if (!value || Number.isNaN(new Date(value).getTime())) throw new Error(`Row ${row}: ${field} must be a valid ISO date.`);
  return new Date(value).toISOString();
}

export function parseSyntheticCsv<S extends CsvSource>(source: S, text: string): CsvRecordMap[S][] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const headers = parsed.meta.fields ?? [];
  const missing = requiredColumns[source].filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);
  if (!parsed.data.length) throw new Error('The CSV contains no data rows.');

  return parsed.data.map((record, index) => {
    const row = index + 2;
    if (source === 'gateway') {
      if (!['captured', 'failed'].includes(record.status)) throw new Error(`Row ${row}: gateway status must be captured or failed.`);
      if (record.currency !== 'INR') throw new Error(`Row ${row}: only INR sandbox records are supported.`);
      return {
        transactionId: record.transaction_id.trim().toUpperCase(),
        merchantId: record.merchant_id.trim(),
        merchantName: record.merchant_name.trim(),
        amount: positiveNumber(record.amount, 'amount', row),
        currency: 'INR',
        status: record.status as GatewayRecord['status'],
        gatewayReference: record.gateway_reference.trim(),
        capturedAt: validDate(record.captured_at, 'captured_at', row) ?? '',
        expectedSettlementMinutes: positiveNumber(record.expected_settlement_minutes, 'expected_settlement_minutes', row),
      } as CsvRecordMap[S];
    }
    if (source === 'bank') {
      if (!['pending', 'credited', 'failed'].includes(record.status)) throw new Error(`Row ${row}: bank status must be pending, credited, or failed.`);
      return {
        bankReference: record.bank_reference.trim(),
        settlementId: record.settlement_id.trim(),
        transactionId: record.transaction_id.trim().toUpperCase(),
        amount: positiveNumber(record.amount, 'amount', row),
        status: record.status as BankRecord['status'],
        utr: record.utr?.trim() || undefined,
        creditedAt: validDate(record.credited_at, 'credited_at', row, true),
      } as CsvRecordMap[S];
    }
    if (!['posted', 'reversed'].includes(record.status)) throw new Error(`Row ${row}: ledger status must be posted or reversed.`);
    return {
      ledgerReference: record.ledger_reference.trim(),
      settlementId: record.settlement_id.trim(),
      transactionId: record.transaction_id.trim().toUpperCase(),
      amount: positiveNumber(record.amount, 'amount', row),
      status: record.status as LedgerRecord['status'],
      postedAt: validDate(record.posted_at, 'posted_at', row) ?? '',
    } as CsvRecordMap[S];
  });
}

export function replaceDatasetSource<S extends CsvSource>(
  dataset: SettlementDataset,
  source: S,
  records: CsvRecordMap[S][],
): SettlementDataset {
  return { ...dataset, [source]: records } as SettlementDataset;
}
