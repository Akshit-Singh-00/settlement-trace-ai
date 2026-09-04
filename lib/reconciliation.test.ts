import { describe, expect, it } from 'vitest';
import { buildSandboxData } from './sandbox-data';
import { extractTransactionId, reconcileTransaction } from './reconciliation';

const reference = new Date('2026-09-04T12:00:00.000Z');
const dataset = buildSandboxData(reference);
const trace = (transactionId: string) => reconcileTransaction(transactionId, dataset, reference);

describe('reconcileTransaction', () => {
  it('reconciles a successful settlement end to end', () => {
    const result = trace('TXN-1001');
    expect(result.status).toBe('successful');
    expect(result.stage).toBe('ledger');
    expect(result.confidence).toBe(99);
    expect(result.timeline).toHaveLength(5);
    expect(result.timeline.every((stage) => stage.status === 'complete')).toBe(true);
  });

  it('finds a captured payment missing from settlement', () => {
    const result = trace('TXN-1048');
    expect(result.status).toBe('delayed');
    expect(result.stage).toBe('settlement');
    expect(result.rootCause).toContain('missing from a settlement batch');
    expect(result.exceptions).toContain('Settlement record unavailable');
  });

  it('keeps an in-progress settlement inside its SLA', () => {
    const result = trace('TXN-1023');
    expect(result.status).toBe('pending');
    expect(result.stage).toBe('settlement');
    expect(result.slaMinutesRemaining).toBeGreaterThan(0);
  });

  it('reports a processed settlement with pending bank credit', () => {
    const result = trace('TXN-1055');
    expect(result.status).toBe('pending');
    expect(result.stage).toBe('bank');
    expect(result.slaMinutesRemaining).toBe(133);
  });

  it('reports a missing merchant ledger entry', () => {
    const result = trace('TXN-1062');
    expect(result.status).toBe('delayed');
    expect(result.stage).toBe('ledger');
    expect(result.exceptions).toContain('Merchant ledger record unavailable');
  });

  it('stops at a failed settlement', () => {
    const result = trace('TXN-1071');
    expect(result.status).toBe('failed');
    expect(result.stage).toBe('settlement');
    expect(result.confidence).toBe(99);
  });

  it('detects an amount mismatch before tracing downstream', () => {
    const result = trace('TXN-1080');
    expect(result.status).toBe('mismatch');
    expect(result.stage).toBe('settlement');
    expect(result.exceptions).toContain('Amount mismatch detected');
  });

  it('detects a settlement UTR mismatch at the bank', () => {
    const result = trace('TXN-1088');
    expect(result.status).toBe('mismatch');
    expect(result.stage).toBe('bank');
    expect(result.exceptions).toContain('Settlement reference inconsistent');
  });

  it('detects duplicate ledger postings', () => {
    const result = trace('TXN-1090');
    expect(result.status).toBe('mismatch');
    expect(result.stage).toBe('ledger');
    expect(result.exceptions).toContain('Multiple ledger matches found');
  });

  it('does not invent certainty for conflicting evidence', () => {
    const result = trace('TXN-1097');
    expect(result.status).toBe('uncertain');
    expect(result.confidence).toBeLessThan(50);
    expect(result.exceptions).toContain('Conflicting records');
  });

  it('does not calculate an SLA without a capture timestamp', () => {
    const result = trace('TXN-1102');
    expect(result.status).toBe('uncertain');
    expect(result.stage).toBe('gateway');
    expect(result.slaMinutesRemaining).toBeUndefined();
  });

  it('returns an evidence-aware unknown state for an absent transaction', () => {
    const result = trace('TXN-9999');
    expect(result.status).toBe('uncertain');
    expect(result.stage).toBe('gateway');
    expect(result.evidence.every((group) => group.records.length === 0)).toBe(true);
  });
});

describe('extractTransactionId', () => {
  it('extracts an ID from a natural-language support question', () => {
    expect(extractTransactionId('Has txn-1090 reached the bank?')).toBe('TXN-1090');
  });
});
