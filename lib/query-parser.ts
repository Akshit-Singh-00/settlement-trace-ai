import { reconcileTransaction } from './reconciliation';
import type { InvestigationResult, InvestigationStatus, SettlementDataset } from './settlement-types';

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

const STATUS_TERMS: Array<[RegExp, InvestigationStatus]> = [
  [/\b(success|successful|succeeded|settled|complete|completed)\b/i, 'successful'],
  [/\b(pending|processing|awaiting)\b/i, 'pending'],
  [/\b(delayed|delay|overdue|late)\b/i, 'delayed'],
  [/\b(failed|failure|rejected)\b/i, 'failed'],
  [/\b(mismatch|mismatches|conflict|conflicting|duplicate|duplicates|anomal(?:y|ies))\b/i, 'mismatch'],
  [/\b(uncertain|inconclusive|ambiguous)\b/i, 'uncertain'],
];

export interface ParsedInvestigationQuery {
  raw: string;
  transactionId?: string;
  date?: string;
  statuses: InvestigationStatus[];
  chips: string[];
  mode: 'transaction' | 'list' | 'empty';
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

export function parseDateFromQuery(query: string, reference = new Date()) {
  if (/\btoday\b/i.test(query)) {
    return validDate(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  }

  const iso = query.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dayFirst = query.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(20\d{2}))?\b/i);
  if (dayFirst) {
    return validDate(Number(dayFirst[3] ?? reference.getUTCFullYear()), MONTHS[dayFirst[2].toLowerCase()], Number(dayFirst[1]));
  }

  const monthFirst = query.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i);
  if (monthFirst) {
    return validDate(Number(monthFirst[3] ?? reference.getUTCFullYear()), MONTHS[monthFirst[1].toLowerCase()], Number(monthFirst[2]));
  }

  return undefined;
}

export function parseInvestigationQuery(query: string, reference = new Date()): ParsedInvestigationQuery {
  const raw = query.trim();
  if (!raw) return { raw, statuses: [], chips: [], mode: 'empty' };

  const transactionId = raw.toUpperCase().match(/\bTXN-[A-Z0-9-]{3,}\b/)?.[0];
  const date = parseDateFromQuery(raw, reference);
  const statuses = STATUS_TERMS.filter(([pattern]) => pattern.test(raw)).map(([, status]) => status);
  const uniqueStatuses = [...new Set(statuses)];
  const chips = [
    ...(transactionId ? [transactionId] : []),
    ...(date ? [date] : []),
    ...uniqueStatuses.map((status) => status[0].toUpperCase() + status.slice(1)),
  ];
  return {
    raw,
    transactionId,
    date,
    statuses: uniqueStatuses,
    chips,
    mode: transactionId ? 'transaction' : date || uniqueStatuses.length ? 'list' : 'transaction',
  };
}

export function searchTransactions(
  query: ParsedInvestigationQuery,
  dataset: SettlementDataset,
  reference = new Date(),
): InvestigationResult[] {
  if (query.mode === 'empty') return [];
  if (query.transactionId) return [reconcileTransaction(query.transactionId, dataset, reference)];

  return dataset.gateway
    .map((record) => reconcileTransaction(record.transactionId, dataset, reference))
    .filter((result) => {
      const dateMatches = !query.date || result.transactionTimestamp?.slice(0, 10) === query.date;
      const statusMatches = query.statuses.length === 0 || query.statuses.includes(result.status);
      return dateMatches && statusMatches;
    })
    .sort((a, b) => (b.transactionTimestamp ?? '').localeCompare(a.transactionTimestamp ?? ''));
}
