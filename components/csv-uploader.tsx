'use client';

import { useState } from 'react';
import { CheckCircle2, FileUp, ShieldAlert, UploadCloud } from 'lucide-react';
import { parseSyntheticCsv, replaceDatasetSource, type CsvSource } from '@/lib/csv-import';
import type { SettlementDataset } from '@/lib/settlement-types';

const sources: Array<{ id: CsvSource; label: string; hint: string }> = [
  { id: 'gateway', label: 'Gateway CSV', hint: 'Capture and merchant records' },
  { id: 'bank', label: 'Bank CSV', hint: 'Credit confirmation records' },
  { id: 'ledger', label: 'Ledger CSV', hint: 'Merchant posting records' },
];

export function CsvUploader({
  dataset,
  onDatasetChange,
}: {
  dataset: SettlementDataset;
  onDatasetChange: (dataset: SettlementDataset) => void;
}) {
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  async function importFile(source: CsvSource, file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage({ tone: 'error', text: 'Choose a .csv file; no dataset changes were made.' });
      return;
    }
    try {
      const records = parseSyntheticCsv(source, await file.text());
      onDatasetChange(replaceDatasetSource(dataset, source, records));
      setMessage({ tone: 'success', text: `${records.length} ${source} record${records.length === 1 ? '' : 's'} validated and loaded.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The CSV could not be validated.' });
    }
  }

  return (
    <section className="upload-card" aria-labelledby="upload-title">
      <div className="upload-copy">
        <span className="section-kicker">Optional data lab</span>
        <h3 id="upload-title"><UploadCloud size={21} /> Load your synthetic CSVs</h3>
        <p>Replace a source safely. Headers and every row are validated before the active sandbox changes.</p>
      </div>
      <div className="upload-grid">
        {sources.map((source) => (
          <label key={source.id}>
            <FileUp size={17} />
            <span><strong>{source.label}</strong><small>{source.hint}</small></span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void importFile(source.id, event.target.files?.[0])} />
          </label>
        ))}
      </div>
      {message && (
        <output className={`upload-message ${message.tone}`}>
          {message.tone === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}{message.text}
        </output>
      )}
    </section>
  );
}
