import Papa from 'papaparse';
import type { BankRecord, GatewayRecord, LedgerRecord, SettlementDataset, SettlementRecord } from './settlement-types';

export type CsvSource = 'gateway' | 'settlement' | 'bank' | 'ledger';

type CsvRecordMap = {
  gateway: GatewayRecord;
  settlement: SettlementRecord;
  bank: BankRecord;
  ledger: LedgerRecord;
};

const requiredColumns: Record<CsvSource, string[]> = {
  gateway: ['transaction_id', 'merchant_id', 'merchant_name', 'amount', 'currency', 'status', 'gateway_reference', 'captured_at', 'expected_settlement_minutes'],
  settlement: ['settlement_id', 'transaction_id', 'amount', 'status', 'gateway_reference', 'created_at'],
  bank: ['bank_reference', 'settlement_id', 'transaction_id', 'amount', 'status'],
  ledger: ['ledger_reference', 'settlement_id', 'transaction_id', 'amount', 'status', 'posted_at'],
};

const uniqueField: Record<CsvSource, string> = {
  gateway: 'transaction_id', settlement: 'settlement_id', bank: 'bank_reference', ledger: 'ledger_reference',
};

export class CsvValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? 'The CSV could not be validated.');
    this.name = 'CsvValidationError';
    this.issues = issues;
  }
}

function required(value: string | undefined, field: string, row: number) {
  if (!value?.trim()) throw new Error(`Row ${row}: ${field} is required.`);
  return value.trim();
}

function positiveNumber(value: string | undefined, field: string, row: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Row ${row}: ${field} must be a positive number.`);
  return parsed;
}

function validDate(value: string | undefined, field: string, row: number, optional = false) {
  if (!value?.trim() && optional) return undefined;
  if (!value || Number.isNaN(new Date(value).getTime())) throw new Error(`Row ${row}: ${field} must be a valid ISO date.`);
  return new Date(value).toISOString();
}

function transactionId(value: string | undefined, row: number) {
  const normalized = required(value, 'transaction_id', row).toUpperCase();
  if (!/^TXN-[A-Z0-9-]{3,}$/.test(normalized)) throw new Error(`Row ${row}: transaction_id must use a value such as TXN-5000.`);
  return normalized;
}

function settlementId(value: string | undefined, row: number) {
  const normalized = required(value, 'settlement_id', row).toUpperCase();
  if (!/^SET-[A-Z0-9-]{2,}$/.test(normalized)) throw new Error(`Row ${row}: settlement_id must use a value such as SET-500.`);
  return normalized;
}

function normalizeCurrency(value?: string) {
  return value?.trim().toUpperCase() || undefined;
}

export function parseSyntheticCsv<S extends CsvSource>(source: S, text: string): CsvRecordMap[S][] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const issues = parsed.errors.map((error) => `CSV row ${(error.row ?? 0) + 1}: ${error.message}`);
  const headers = parsed.meta.fields ?? [];
  const missing = requiredColumns[source].filter((column) => !headers.includes(column));
  if (missing.length) issues.push(`Missing required columns: ${missing.join(', ')}`);
  if (!parsed.data.length) issues.push('The CSV contains no data rows.');
  if (issues.length) throw new CsvValidationError(issues);

  const seen = new Set<string>();
  const records: CsvRecordMap[S][] = [];
  parsed.data.forEach((record, index) => {
    const row = index + 2;
    try {
      const identity = required(record[uniqueField[source]], uniqueField[source], row).toUpperCase();
      if (seen.has(identity)) throw new Error(`Row ${row}: duplicate ${uniqueField[source]} ${identity}.`);
      seen.add(identity);

      if (source === 'gateway') {
        if (!['captured', 'failed'].includes(record.status)) throw new Error(`Row ${row}: gateway status must be captured or failed.`);
        const currency = required(record.currency, 'currency', row).toUpperCase();
        records.push({
          transactionId: transactionId(record.transaction_id, row),
          merchantId: required(record.merchant_id, 'merchant_id', row),
          merchantName: required(record.merchant_name, 'merchant_name', row),
          amount: positiveNumber(record.amount, 'amount', row),
          currency,
          status: record.status as GatewayRecord['status'],
          gatewayReference: required(record.gateway_reference, 'gateway_reference', row),
          capturedAt: validDate(record.captured_at, 'captured_at', row) ?? '',
          expectedSettlementMinutes: positiveNumber(record.expected_settlement_minutes, 'expected_settlement_minutes', row),
        } as CsvRecordMap[S]);
        return;
      }

      if (source === 'settlement') {
        if (!['created', 'processed', 'failed'].includes(record.status)) throw new Error(`Row ${row}: settlement status must be created, processed, or failed.`);
        const processedAt = validDate(record.processed_at, 'processed_at', row, true);
        if (record.status === 'processed' && !processedAt) throw new Error(`Row ${row}: processed_at is required when settlement status is processed.`);
        records.push({
          settlementId: settlementId(record.settlement_id, row),
          transactionId: transactionId(record.transaction_id, row),
          merchantId: record.merchant_id?.trim() || undefined,
          amount: positiveNumber(record.amount, 'amount', row),
          currency: normalizeCurrency(record.currency),
          status: record.status as SettlementRecord['status'],
          gatewayReference: required(record.gateway_reference, 'gateway_reference', row),
          utr: record.utr?.trim() || undefined,
          createdAt: validDate(record.created_at, 'created_at', row) ?? '',
          processedAt,
        } as CsvRecordMap[S]);
        return;
      }

      if (source === 'bank') {
        if (!['pending', 'credited', 'failed'].includes(record.status)) throw new Error(`Row ${row}: bank status must be pending, credited, or failed.`);
        const parsedSettlementId = settlementId(record.settlement_id, row);
        const parsedTransactionId = transactionId(record.transaction_id, row);
        const creditedAt = validDate(record.credited_at, 'credited_at', row, true);
        if (record.status === 'credited' && !creditedAt) throw new Error(`Row ${row}: credited_at is required when bank status is credited.`);
        records.push({
          bankReference: required(record.bank_reference, 'bank_reference', row),
          settlementId: parsedSettlementId,
          transactionId: parsedTransactionId,
          merchantId: record.merchant_id?.trim() || undefined,
          amount: positiveNumber(record.amount, 'amount', row),
          currency: normalizeCurrency(record.currency),
          status: record.status as BankRecord['status'],
          utr: record.utr?.trim() || undefined,
          creditedAt,
        } as CsvRecordMap[S]);
        return;
      }

      if (!['posted', 'reversed'].includes(record.status)) throw new Error(`Row ${row}: ledger status must be posted or reversed.`);
      records.push({
        ledgerReference: required(record.ledger_reference, 'ledger_reference', row),
        settlementId: settlementId(record.settlement_id, row),
        transactionId: transactionId(record.transaction_id, row),
        merchantId: record.merchant_id?.trim() || undefined,
        amount: positiveNumber(record.amount, 'amount', row),
        currency: normalizeCurrency(record.currency),
        bankReference: record.bank_reference?.trim() || undefined,
        utr: record.utr?.trim() || undefined,
        status: record.status as LedgerRecord['status'],
        postedAt: validDate(record.posted_at, 'posted_at', row) ?? '',
      } as CsvRecordMap[S]);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `Row ${row}: invalid record.`);
    }
  });

  if (issues.length) throw new CsvValidationError(issues);
  return records;
}

export function replaceDatasetSource<S extends CsvSource>(
  dataset: SettlementDataset,
  source: S,
  records: CsvRecordMap[S][],
): SettlementDataset {
  if (source === 'settlement') return { ...dataset, settlements: records as SettlementRecord[] };
  return { ...dataset, [source]: records } as SettlementDataset;
}
