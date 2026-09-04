import type {
  DemoCase,
  SettlementDataset,
} from './settlement-types';

const isoMinutesAgo = (reference: Date, minutes: number) =>
  new Date(reference.getTime() - minutes * 60_000).toISOString();

const archive = (time: string) => `2026-09-03T${time}:00.000Z`;

export const demoCases: DemoCase[] = [
  { transactionId: 'TXN-1001', label: 'Settled cleanly', category: 'successful', summary: 'All four records reconcile.' },
  { transactionId: 'TXN-1048', label: 'Missing settlement', category: 'delayed', summary: 'Captured, never batched.' },
  { transactionId: 'TXN-1023', label: 'Inside SLA', category: 'pending', summary: 'Batch is still processing.' },
  { transactionId: 'TXN-1055', label: 'Bank credit pending', category: 'pending', summary: 'Processed, awaiting bank.' },
  { transactionId: 'TXN-1062', label: 'Ledger missing', category: 'delayed', summary: 'Bank credited, ledger absent.' },
  { transactionId: 'TXN-1071', label: 'Settlement failed', category: 'failed', summary: 'Batch rejected upstream.' },
  { transactionId: 'TXN-1080', label: 'Amount mismatch', category: 'mismatch', summary: 'Settlement total conflicts.' },
  { transactionId: 'TXN-1088', label: 'Reference mismatch', category: 'mismatch', summary: 'UTR differs at the bank.' },
  { transactionId: 'TXN-1090', label: 'Duplicate ledger', category: 'mismatch', summary: 'Two postings found.' },
  { transactionId: 'TXN-1097', label: 'Conflicting records', category: 'uncertain', summary: 'Bank failure vs ledger post.' },
  { transactionId: 'TXN-1102', label: 'Insufficient evidence', category: 'uncertain', summary: 'Capture time is unavailable.' },
];

export function buildSandboxData(reference = new Date()): SettlementDataset {
  const gateway = [
    ['TXN-1001', 'Nila Groceries', 184900, 'captured', 1810],
    ['TXN-1048', 'Orbit Mobility', 784500, 'captured', 380],
    ['TXN-1023', 'Mango Studio', 125000, 'captured', 44],
    ['TXN-1055', 'Northstar Labs', 298000, 'captured', 155],
    ['TXN-1062', 'Paperboat Retail', 512400, 'captured', 390],
    ['TXN-1071', 'Terra Foods', 92000, 'captured', 1700],
    ['TXN-1080', 'Luma Living', 349900, 'captured', 1650],
    ['TXN-1088', 'Kite Commerce', 643200, 'captured', 305],
    ['TXN-1090', 'Amber Health', 214000, 'captured', 280],
    ['TXN-1097', 'Saffron Cloud', 475600, 'captured', 360],
    ['TXN-1102', 'Delta Works', 156700, 'captured', -1],
  ] as const;

  const data: SettlementDataset = {
    gateway: gateway.map(([transactionId, merchantName, amount, status, age], index) => ({
      transactionId,
      merchantId: `MRC-${String(index + 31).padStart(3, '0')}`,
      merchantName,
      amount,
      currency: 'INR',
      status,
      gatewayReference: `GTW-${transactionId.slice(4)}`,
      capturedAt: age < 0 ? ''
        : transactionId === 'TXN-1001' ? archive('06:00')
          : transactionId === 'TXN-1071' ? archive('07:40')
            : transactionId === 'TXN-1080' ? archive('08:30')
              : isoMinutesAgo(reference, age),
      expectedSettlementMinutes: 120,
    })),
    settlements: [
      { settlementId: 'SET-201', transactionId: 'TXN-1001', amount: 184900, status: 'processed', gatewayReference: 'GTW-1001', utr: 'UTR-88412001', createdAt: archive('06:50'), processedAt: archive('08:05') },
      { settlementId: 'SET-223', transactionId: 'TXN-1023', amount: 125000, status: 'created', gatewayReference: 'GTW-1023', createdAt: isoMinutesAgo(reference, 31) },
      { settlementId: 'SET-255', transactionId: 'TXN-1055', amount: 298000, status: 'processed', gatewayReference: 'GTW-1055', utr: 'UTR-88412555', createdAt: isoMinutesAgo(reference, 135), processedAt: isoMinutesAgo(reference, 47) },
      { settlementId: 'SET-262', transactionId: 'TXN-1062', amount: 512400, status: 'processed', gatewayReference: 'GTW-1062', utr: 'UTR-88412662', createdAt: isoMinutesAgo(reference, 330), processedAt: isoMinutesAgo(reference, 250) },
      { settlementId: 'SET-271', transactionId: 'TXN-1071', amount: 92000, status: 'failed', gatewayReference: 'GTW-1071', createdAt: archive('08:09'), processedAt: archive('08:25') },
      { settlementId: 'SET-280', transactionId: 'TXN-1080', amount: 344900, status: 'processed', gatewayReference: 'GTW-1080', utr: 'UTR-88412880', createdAt: archive('09:00'), processedAt: archive('10:00') },
      { settlementId: 'SET-288', transactionId: 'TXN-1088', amount: 643200, status: 'processed', gatewayReference: 'GTW-1088', utr: 'UTR-EXPECTED-88', createdAt: isoMinutesAgo(reference, 270), processedAt: isoMinutesAgo(reference, 220) },
      { settlementId: 'SET-290', transactionId: 'TXN-1090', amount: 214000, status: 'processed', gatewayReference: 'GTW-1090', utr: 'UTR-88412990', createdAt: isoMinutesAgo(reference, 250), processedAt: isoMinutesAgo(reference, 205) },
      { settlementId: 'SET-297', transactionId: 'TXN-1097', amount: 475600, status: 'processed', gatewayReference: 'GTW-1097', utr: 'UTR-88412997', createdAt: isoMinutesAgo(reference, 330), processedAt: isoMinutesAgo(reference, 270) },
    ],
    bank: [
      { bankReference: 'BNK-501', settlementId: 'SET-201', transactionId: 'TXN-1001', amount: 184900, status: 'credited', utr: 'UTR-88412001', creditedAt: archive('09:10') },
      { bankReference: 'BNK-555', settlementId: 'SET-255', transactionId: 'TXN-1055', amount: 298000, status: 'pending', utr: 'UTR-88412555' },
      { bankReference: 'BNK-562', settlementId: 'SET-262', transactionId: 'TXN-1062', amount: 512400, status: 'credited', utr: 'UTR-88412662', creditedAt: isoMinutesAgo(reference, 180) },
      { bankReference: 'BNK-588', settlementId: 'SET-288', transactionId: 'TXN-1088', amount: 643200, status: 'credited', utr: 'UTR-CONFLICT-88', creditedAt: isoMinutesAgo(reference, 172) },
      { bankReference: 'BNK-590', settlementId: 'SET-290', transactionId: 'TXN-1090', amount: 214000, status: 'credited', utr: 'UTR-88412990', creditedAt: isoMinutesAgo(reference, 150) },
      { bankReference: 'BNK-597', settlementId: 'SET-297', transactionId: 'TXN-1097', amount: 475600, status: 'failed', utr: 'UTR-88412997' },
    ],
    ledger: [
      { ledgerReference: 'LDG-801', settlementId: 'SET-201', transactionId: 'TXN-1001', amount: 184900, status: 'posted', postedAt: archive('09:25') },
      { ledgerReference: 'LDG-890-A', settlementId: 'SET-290', transactionId: 'TXN-1090', amount: 214000, status: 'posted', postedAt: isoMinutesAgo(reference, 130) },
      { ledgerReference: 'LDG-890-B', settlementId: 'SET-290', transactionId: 'TXN-1090', amount: 214000, status: 'posted', postedAt: isoMinutesAgo(reference, 128) },
      { ledgerReference: 'LDG-897', settlementId: 'SET-297', transactionId: 'TXN-1097', amount: 475600, status: 'posted', postedAt: isoMinutesAgo(reference, 160) },
    ],
  };

  const gatewayByTransaction = new Map(data.gateway.map((record) => [record.transactionId, record]));
  data.settlements = data.settlements.map((record) => {
    const source = gatewayByTransaction.get(record.transactionId);
    return { ...record, merchantId: source?.merchantId, currency: source?.currency };
  });
  data.bank = data.bank.map((record) => {
    const source = gatewayByTransaction.get(record.transactionId);
    return { ...record, merchantId: source?.merchantId, currency: source?.currency };
  });
  data.ledger = data.ledger.map((record) => {
    const source = gatewayByTransaction.get(record.transactionId);
    const bank = data.bank.find((candidate) => candidate.settlementId === record.settlementId);
    return {
      ...record,
      merchantId: source?.merchantId,
      currency: source?.currency,
      bankReference: bank?.bankReference,
      utr: bank?.utr,
    };
  });

  return data;
}
