'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, FileUp, LoaderCircle, RotateCcw, ShieldAlert, UploadCloud } from 'lucide-react';
import { CsvValidationError, parseSyntheticCsv, replaceDatasetSource, type CsvSource } from '@/lib/csv-import';
import type { SettlementDataset } from '@/lib/settlement-types';

const sources: Array<{ id: CsvSource; label: string; hint: string }> = [
  { id: 'gateway', label: 'Gateway CSV', hint: 'Capture and merchant records' },
  { id: 'settlement', label: 'Settlement CSV', hint: 'Batch and processor records' },
  { id: 'bank', label: 'Bank CSV', hint: 'Credit confirmation records' },
  { id: 'ledger', label: 'Ledger CSV', hint: 'Merchant posting records' },
];

export function CsvUploader({
  dataset,
  onDatasetChange,
  onReset,
}: {
  dataset: SettlementDataset;
  onDatasetChange: (dataset: SettlementDataset) => void;
  onReset: () => void;
}) {
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string; details?: string[] }>();
  const [processing, setProcessing] = useState<CsvSource>();
  const [dragging, setDragging] = useState<CsvSource>();

  async function importFile(source: CsvSource, file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage({ tone: 'error', text: 'Choose a .csv file; no dataset changes were made.' });
      return;
    }
    setProcessing(source);
    setMessage(undefined);
    try {
      const records = parseSyntheticCsv(source, await file.text());
      onDatasetChange(replaceDatasetSource(dataset, source, records));
      setMessage({ tone: 'success', text: `${records.length} ${source} record${records.length === 1 ? '' : 's'} validated and loaded.` });
    } catch (error) {
      const details = error instanceof CsvValidationError ? error.issues.slice(0, 8) : undefined;
      setMessage({ tone: 'error', text: 'The CSV was not imported. Fix the highlighted validation issues and try again.', details });
    } finally {
      setProcessing(undefined);
      setDragging(undefined);
    }
  }

  return (
    <section className="upload-card" aria-labelledby="upload-title">
      <div className="upload-copy">
        <span className="section-kicker">Optional data lab</span>
        <h3 id="upload-title"><UploadCloud size={21} /> Load your synthetic CSVs</h3>
        <p>Replace a source safely. Headers and every row are validated before the active sandbox changes.</p>
        <button className="reset-data" type="button" onClick={() => { onReset(); setMessage({ tone: 'success', text: 'The original synthetic dataset was restored.' }); }}><RotateCcw size={14} /> Reset demo data</button>
      </div>
      <div className="upload-grid">
        {sources.map((source) => (
          <motion.label
            key={source.id}
            className={dragging === source.id ? 'dragging' : ''}
            whileTap={{ scale: 0.99 }}
            onDragEnter={() => setDragging(source.id)}
            onDragLeave={() => setDragging(undefined)}
            onDrop={() => setDragging(undefined)}
          >
            {processing === source.id ? <LoaderCircle className="spin" size={17} /> : <FileUp size={17} />}
            <span><strong>{source.label}</strong><small>{source.hint}</small></span>
            <input aria-label={`Upload ${source.label}`} type="file" accept=".csv,text/csv" disabled={Boolean(processing)} onChange={(event) => { void importFile(source.id, event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </motion.label>
        ))}
      </div>
      <AnimatePresence>{message && (
        <motion.output initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`upload-message ${message.tone}`}>
          <span>{message.tone === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}{message.text}</span>
          {message.details?.length ? <ul>{message.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
        </motion.output>
      )}</AnimatePresence>
    </section>
  );
}
