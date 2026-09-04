'use client';

import { useEffect, useMemo, useState } from 'react';
import { animate, motion, stagger, useReducedMotion } from 'framer-motion';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Gauge, SearchCheck, Timer, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '@/components/theme-provider';
import { reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, InvestigationStatus, SettlementDataset } from '@/lib/settlement-types';

const statusColors: Record<InvestigationStatus, string> = {
  successful: '#16a36a', pending: '#0891b2', delayed: '#d97706', failed: '#e5485d', mismatch: '#8b5cf6', uncertain: '#718096',
};

function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const controls = animate(0, value, { duration: reducedMotion ? 0.01 : 0.55, ease: 'easeOut', onUpdate: (latest) => setDisplay(Math.round(latest)) });
    return () => controls.stop();
  }, [reducedMotion, value]);
  return <>{display}{suffix}</>;
}

export function OperationsDashboard({
  dataset,
  recent,
  referenceTime,
  onInvestigate,
  onFilter,
}: {
  dataset: SettlementDataset;
  recent: InvestigationResult[];
  referenceTime: string;
  onInvestigate: (transactionId: string) => void;
  onFilter: (status: InvestigationStatus) => void;
}) {
  const reducedMotion = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const catalog = useMemo(() => dataset.gateway.map((item) => reconcileTransaction(item.transactionId, dataset, new Date(referenceTime))), [dataset, referenceTime]);
  const counts = useMemo(() => catalog.reduce<Record<InvestigationStatus, number>>(
    (accumulator, item) => ({ ...accumulator, [item.status]: accumulator[item.status] + 1 }),
    { successful: 0, pending: 0, delayed: 0, failed: 0, mismatch: 0, uncertain: 0 },
  ), [catalog]);
  const validLatencies = catalog.flatMap((result) => result.timeline.map((stage) => stage.latencyMinutes).filter((value): value is number => value !== undefined && value >= 0));
  const averageLatency = validLatencies.length ? Math.round(validLatencies.reduce((total, value) => total + value, 0) / validLatencies.length) : 0;
  const metrics: Array<{ label: string; value: number; detail: string; status?: InvestigationStatus; suffix?: string; icon: typeof SearchCheck }> = [
    { label: 'Transactions', value: catalog.length, detail: 'Active synthetic dataset', icon: SearchCheck },
    { label: 'Successful', value: counts.successful, detail: 'Fully reconciled', status: 'successful', icon: CheckCircle2 },
    { label: 'Pending', value: counts.pending, detail: 'Inside current window', status: 'pending', icon: Clock3 },
    { label: 'Delayed', value: counts.delayed, detail: 'Past expected window', status: 'delayed', icon: Timer },
    { label: 'Failed', value: counts.failed, detail: 'Stopped upstream', status: 'failed', icon: XCircle },
    { label: 'Mismatches', value: counts.mismatch, detail: 'Evidence conflicts', status: 'mismatch', icon: AlertTriangle },
    { label: 'Uncertain', value: counts.uncertain, detail: 'Manual review', status: 'uncertain', icon: Gauge },
    { label: 'Avg stage latency', value: averageLatency, suffix: 'm', detail: 'Valid stage intervals', icon: Activity },
  ];
  const statusData = Object.entries(counts).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value, fill: statusColors[name as InvestigationStatus] }));
  const latencyData = catalog.map((result) => ({
    transaction: result.transactionId.replace('TXN-', ''),
    minutes: result.timeline.reduce((total, stage) => total + Math.max(0, stage.latencyMinutes ?? 0), 0),
  }));
  const anomalyCounts = new Map<string, number>();
  catalog.forEach((result) => result.validationIssues.forEach((item) => anomalyCounts.set(item.message, (anomalyCounts.get(item.message) ?? 0) + 1)));
  const anomalyData = [...anomalyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name: name.replace(' detected', ''), count }));
  const recentRows = recent.length ? recent.slice(0, 5) : catalog.slice(0, 5);
  const axisColor = resolvedTheme === 'dark' ? '#7690a5' : '#526778';
  const gridColor = resolvedTheme === 'dark' ? 'rgba(133,176,204,.1)' : 'rgba(42,82,105,.13)';
  const tooltipStyle = { background: resolvedTheme === 'dark' ? '#07121f' : '#ffffff', color: resolvedTheme === 'dark' ? '#e6f5fb' : '#183242', border: `1px solid ${gridColor}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(22,46,61,.12)' };

  return (
    <section className="dashboard-section" id="operations" aria-labelledby="operations-title">
      <div className="section-heading compact-heading"><div><span className="section-kicker">Support operations</span><h2 id="operations-title">Settlement health at a glance</h2></div><span className="dashboard-caption"><Activity size={14} /> Derived from reconciliation results</span></div>

      <motion.div className="metrics-grid" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }} variants={{ visible: { transition: { delayChildren: reducedMotion ? 0 : stagger(0.055) } } }}>
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return <motion.button type="button" key={metric.label} variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }} onClick={() => metric.status && onFilter(metric.status)} disabled={!metric.status} aria-label={metric.status ? `Filter ${metric.status} transactions` : metric.label}>
            <Icon size={18} /><strong><CountUp value={metric.value} suffix={metric.suffix} /></strong><span>{metric.label}</span><small>{metric.detail}</small>
          </motion.button>;
        })}
      </motion.div>

      <div className="charts-grid">
        <motion.article className="chart-card" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className="panel-title"><span>Status distribution</span><small>{catalog.length} transactions</small></div>
          <div className="donut-wrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie isAnimationActive={!reducedMotion} data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none" /><Tooltip contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer>
            <div className="chart-legend">{statusData.map((item) => <button type="button" key={item.name} onClick={() => onFilter(item.name as InvestigationStatus)}><i style={{ backgroundColor: statusColors[item.name as InvestigationStatus] }} />{item.name}<b>{item.value}</b></button>)}</div>
          </div>
        </motion.article>

        <motion.article className="chart-card latency-card" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className="panel-title"><span>Observed journey latency</span><small>Minutes by case</small></div>
          <ResponsiveContainer width="100%" height={250}><BarChart data={latencyData} margin={{ top: 28, right: 4, left: -22, bottom: 0 }}><CartesianGrid stroke={gridColor} vertical={false} /><XAxis dataKey="transaction" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={!reducedMotion} dataKey="minutes" fill="#0891b2" radius={[5, 5, 0, 0]} maxBarSize={24} /></BarChart></ResponsiveContainer>
        </motion.article>

        <motion.article className="chart-card anomaly-card" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className="panel-title"><span>Anomaly distribution</span><small>Detected issues</small></div>
          {anomalyData.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={anomalyData} layout="vertical" margin={{ top: 18, right: 8, left: 2, bottom: 0 }}><CartesianGrid stroke={gridColor} horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={112} tick={{ fill: axisColor, fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} /><Bar isAnimationActive={!reducedMotion} dataKey="count" fill="#8b5cf6" radius={[0, 5, 5, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer> : <div className="chart-empty"><CheckCircle2 /> No anomalies</div>}
        </motion.article>

        <motion.article className="recent-card" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className="panel-title"><span>Recent investigations</span><small>{recent.length ? 'This session' : 'Demo queue'}</small></div>
          <div className="recent-list">{recentRows.map((item) => <button type="button" onClick={() => onInvestigate(item.transactionId)} key={`${item.transactionId}-${item.status}`}><span><b>{item.transactionId}</b><small>{item.rootCause}</small></span><em data-status={item.status}>{item.status}</em></button>)}</div>
        </motion.article>
      </div>
    </section>
  );
}
