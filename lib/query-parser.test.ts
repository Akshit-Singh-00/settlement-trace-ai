import { describe, expect, it } from 'vitest';
import { buildSandboxData } from './sandbox-data';
import { parseDateFromQuery, parseInvestigationQuery, searchTransactions } from './query-parser';

const reference = new Date('2026-09-04T12:00:00.000Z');
const dataset = buildSandboxData(reference);

describe('deterministic investigation query parsing', () => {
  it.each([
    ['Show transactions from 3 September 2026', '2026-09-03'],
    ['Which settlements failed on September 3?', '2026-09-03'],
    ['Transactions on 2026-09-03', '2026-09-03'],
    ['Show pending settlements today', '2026-09-04'],
  ])('parses a supported date from %s', (query, expected) => {
    expect(parseDateFromQuery(query, reference)).toBe(expected);
  });

  it('extracts a transaction and status without an LLM', () => {
    expect(parseInvestigationQuery('Why is TXN-1048 pending?', reference)).toMatchObject({
      transactionId: 'TXN-1048', statuses: ['pending'], mode: 'transaction',
    });
  });

  it('filters failed transactions on a date', () => {
    const parsed = parseInvestigationQuery('Show failed transactions from September 3', reference);
    expect(searchTransactions(parsed, dataset, reference).map((result) => result.transactionId)).toEqual(['TXN-1071']);
  });

  it('finds all mismatch cases deterministically', () => {
    const parsed = parseInvestigationQuery('Which transactions have settlement mismatches?', reference);
    const results = searchTransactions(parsed, dataset, reference);
    expect(results.map((result) => result.transactionId)).toEqual(expect.arrayContaining(['TXN-1080', 'TXN-1088', 'TXN-1090']));
  });

  it('returns an empty list for a valid date with no records', () => {
    const parsed = parseInvestigationQuery('Transactions on 2026-08-01', reference);
    expect(searchTransactions(parsed, dataset, reference)).toEqual([]);
  });
});
