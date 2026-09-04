'use client';

import { Activity, AlertTriangle, CheckCircle2, Clock3, SearchCheck, XCircle } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { demoCases } from '@/lib/sandbox-data';
import { reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, InvestigationStatus, SettlementDataset } from '@/lib/settlement-types';

const statusColors: Record<InvestigationStatus, string> = {
  successful: '#50e6a5',
  pending: '#67e8f9',
  delayed: '#ffbe6b',
  failed: '#ff657a',
  mismatch: '#c58cff',
  uncertain: '#8397aa',
};

const cardIcons = [SearchCheck, CheckCircle2, Clock3, XCircle, AlertTriangle];

export function OperationsDashboard({
  dataset,
  recent,
}: {
  dataset: SettlementDataset;
  recent: InvestigationResult[];
}) {
  const catalog = demoCases.map((item) => reconcileTransaction(item.transactionId, dataset));
  const counts = catalog.reduce<Record<InvestigationStatus, number>>(
    (accumulator, item) => ({ ...accumulator, [item.status]: accumulator[item.status] + 1 }),
    { successful: 0, pending: 0, delayed: 0, failed: 0, mismatch: 0, uncertain: 0 },
  );
  const metrics = [
    { label: 'Catalog cases', value: catalog.length, detail: 'Synthetic investigations' },
    { label: 'Successful', value: counts.successful, detail: 'Fully reconciled' },
    { label: 'Pending + delayed', value: counts.pending + counts.delayed, detail: 'Require monitoring' },
    { label: 'Failed', value: counts.failed, detail: 'Stopped upstream' },
    { label: 'Data anomalies', value: counts.mismatch + counts.uncertain, detail: 'Manual review' },
  ];
  const statusData = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value, fill: statusColors[name as InvestigationStatus] }));
  const latencyData = catalog.map((result) => ({
    transaction: result.transactionId.replace('TXN-', ''),
    minutes: result.timeline.reduce((total, stage) => total + (stage.latencyMinutes ?? 0), 0),
  }));
  const recentRows = recent.length ? recent.slice(0, 5) : catalog.slice(0, 5);

  return (
    <section className="dashboard-section" id="operations" aria-labelledby="operations-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="section-kicker">Support operations</span>
          <h2 id="operations-title">Settlement health at a glance</h2>
        </div>
        <span className="dashboard-caption"><Activity size={14} /> Derived from reconciliation results</span>
      </div>

      <div className="metrics-grid">
        {metrics.map((metric, index) => {
          const Icon = cardIcons[index];
          return (
            <article key={metric.label}>
              <Icon size={18} />
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              <small>{metric.detail}</small>
            </article>
          );
        })}
      </div>

      <div className="charts-grid">
        <article className="chart-card">
          <div className="panel-title"><span>Status distribution</span><small>11 catalog cases</small></div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none" />
                <Tooltip contentStyle={{ background: '#07121f', border: '1px solid rgba(126,187,218,.2)', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              {statusData.map((item) => (
                <span key={item.name}><i style={{ backgroundColor: statusColors[item.name as InvestigationStatus] }} />{item.name}<b>{item.value}</b></span>
              ))}
            </div>
          </div>
        </article>

        <article className="chart-card latency-card">
          <div className="panel-title"><span>Observed journey latency</span><small>Minutes by case</small></div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={latencyData} margin={{ top: 28, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="rgba(133,176,204,.08)" vertical={false} />
              <XAxis dataKey="transaction" tick={{ fill: '#6f879a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6f879a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#07121f', border: '1px solid rgba(126,187,218,.2)', borderRadius: 10 }} />
              <Bar dataKey="minutes" fill="#67e8f9" radius={[5, 5, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="recent-card">
          <div className="panel-title"><span>Recent investigations</span><small>{recent.length ? 'This session' : 'Demo queue'}</small></div>
          <div className="recent-list">
            {recentRows.map((item) => (
              <div key={`${item.transactionId}-${item.status}`}>
                <span><b>{item.transactionId}</b><small>{item.rootCause}</small></span>
                <em data-status={item.status}>{item.status}</em>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
