'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Download,
  FileSearch,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { EvidenceInspector } from '@/components/evidence-inspector';
import { WorkspaceImports } from '@/components/workspace-imports';
import { WorkspaceAdmin } from '@/components/workspace-admin';
import { useTheme } from '@/components/theme-provider';
import {
  canAccess,
  type CaseNote,
  type CaseStatus,
  type ScanSummary,
  type TransactionSummary,
  type WorkspaceCase,
  type WorkspaceMember,
  type WorkspaceSettings,
  type WorkspaceView,
} from '@/lib/workspace-types';
import type {
  InvestigationResult,
  PipelineStage,
} from '@/lib/settlement-types';
import type { ExplanationResponse } from '@/lib/ai-explanation';
import {
  caseLabels,
  workspaceApi as api,
  workspaceDate as date,
  workspaceMoney as money,
} from '@/lib/workspace-client';

type Person = Pick<WorkspaceMember, 'id' | 'display_name' | 'email' | 'role'>;
type Overview = {
  transactions: TransactionSummary[];
  counts: Record<string, number>;
  lastScan: ScanSummary | null;
  members: Person[];
  settings: WorkspaceSettings;
};
type Trace = { result: InvestigationResult; explanation: ExplanationResponse };
export type WorkspaceAction = (
  task: () => Promise<unknown>,
  success?: string,
) => Promise<void>;
export function WorkspacePanel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="ws-panel">
      <div className="ws-panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function WorkspaceLoading() {
  return (
    <div
      className="ws-loading"
      aria-label="Loading workspace"
      aria-live="polite"
    >
      <Skeleton className="h-12 w-64" />
      <div className="ws-stats">
        {[1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export function WorkspaceShell({
  initialView,
}: {
  initialView?: WorkspaceView;
}) {
  const [member, setMember] = useState<WorkspaceMember | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [view, setView] = useState<WorkspaceView>(initialView || 'overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [trace, setTrace] = useState<Trace | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [stage, setStage] = useState<PipelineStage>('gateway');
  const { setPreference } = useTheme();
  const refresh = async () => setOverview(await api<Overview>('overview'));
  const act: WorkspaceAction = async (task, success) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      if (success) setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    void api<{ configured: boolean; member: WorkspaceMember | null }>('session')
      .then(async (data) => {
        if (!data.member) {
          window.location.replace('/login');
          return;
        }
        if (!active) return;
        setMember(data.member);
        setPreference(data.member.theme);
        setView(initialView || data.member.default_view);
        setSessionReady(true);
        try {
          const next = await api<Overview>('overview');
          if (active) setOverview(next);
        } catch (e) {
          if (active)
            setError(
              e instanceof Error ? e.message : 'Unable to load the workspace.',
            );
        }
      })
      .catch(() => window.location.replace('/login'));
    return () => {
      active = false;
    };
  }, [initialView, setPreference]);
  const investigate = async (id: string, rerun = false) => {
    const next = await api<Trace>(
      rerun ? 'trace' : `result/${encodeURIComponent(id)}`,
      rerun ? 'POST' : 'GET',
      rerun ? { transactionId: id } : undefined,
    );
    setTrace(next);
    setTransactionId(next.result.transactionId);
    setStage(next.result.stage);
    setView('investigation');
  };
  if (!sessionReady || !member)
    return (
      <main className="ws-gate">
        <WorkspaceLoading />
      </main>
    );
  const canWrite = canAccess(member.role, 'trace');
  const navigation = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'exceptions' as const, label: 'Exceptions', icon: CircleAlert },
    { id: 'investigation' as const, label: 'Investigation', icon: FileSearch },
    ...(canWrite
      ? [{ id: 'imports' as const, label: 'Sources & imports', icon: Upload }]
      : []),
    { id: 'profile' as const, label: 'My profile', icon: Settings2 },
    ...(member.role === 'admin'
      ? [{ id: 'admin' as const, label: 'Administration', icon: Users }]
      : []),
  ];
  return (
    <div className="ws-app">
      <aside className="ws-sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <span>
            Settlement Trace <b>AI</b>
          </span>
        </Link>
        <span className="ws-eyebrow">TEAM WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={18} />
              {label}
              {id === 'exceptions' && overview && (
                <small>
                  {
                    overview.transactions.filter(
                      (t) => !['successful', 'pending'].includes(t.status),
                    ).length
                  }
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="ws-sidebar-footer">
          <ShieldCheck size={18} />
          <div>
            Access by invitation<small>{member.role} access</small>
          </div>
          <Link href="/" aria-label="Open public demo">
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </aside>
      <div className="ws-body">
        <header className="ws-topbar">
          <span>
            Workspace <span className="ws-separator">/</span>{' '}
            <strong>
              {navigation.find((n) => n.id === view)?.label || 'Administration'}
            </strong>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger className="ws-person">
              <span className="ws-avatar">
                {member.avatar_url ? (
                  <Image
                    unoptimized
                    width={34}
                    height={34}
                    src={member.avatar_url}
                    referrerPolicy="no-referrer"
                    alt=""
                  />
                ) : (
                  (member.display_name || member.email)
                    .slice(0, 1)
                    .toUpperCase()
                )}
              </span>
              <span>
                {member.display_name || member.email}
                <small>{member.role}</small>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setView('profile')}>
                <Settings2 /> Profile & preferences
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void act(async () => {
                    await api('logout', 'POST');
                    window.location.assign('/login');
                  })
                }
              >
                <LogOut /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="ws-main" aria-busy={busy}>
          {error && (
            <div className="ws-error" role="alert">
              {error}
              <Button variant="ghost" onClick={() => setError('')}>
                Dismiss
              </Button>
            </div>
          )}
          {notice && (
            <div className="ws-success" aria-live="polite">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          {busy && (
            <div className="ws-working" aria-live="polite">
              <LoaderCircle className="animate-spin" size={16} /> Working…
            </div>
          )}
          {(view === 'overview' || view === 'exceptions') && (
            <>
              <div className="ws-heading">
                <div>
                  <span className="ws-eyebrow">
                    {view === 'overview'
                      ? 'SETTLEMENT OPERATIONS'
                      : 'REQUIRES ATTENTION'}
                  </span>
                  <h1>
                    {view === 'overview'
                      ? 'Follow the money.'
                      : 'Resolve the exceptions.'}
                  </h1>
                  <p>
                    {overview?.lastScan
                      ? `Last scan ${date(overview.lastScan.created_at, member.timezone)} · ${overview.lastScan.exception_count} exceptions`
                      : 'Import your source records, then scan for gaps and delays.'}
                  </p>
                </div>
                <div className="ws-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(refresh)}
                    aria-label="Refresh overview"
                  >
                    <RefreshCw />
                  </Button>
                  {canWrite && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api('scan', 'POST');
                          await refresh();
                        }, 'Exception scan complete.')
                      }
                    >
                      <Search /> Scan all transactions
                    </Button>
                  )}
                </div>
              </div>
              {overview ? (
                <>
                  <div className="ws-stats">
                    {[
                      [
                        'Transactions',
                        overview.transactions.length,
                        'All imported evidence',
                      ],
                      [
                        'Reconciled',
                        overview.counts.successful || 0,
                        'Complete across all systems',
                      ],
                      [
                        'Exceptions',
                        overview.transactions.filter(
                          (t) => !['successful', 'pending'].includes(t.status),
                        ).length,
                        'Gaps, delays, and conflicts',
                      ],
                      [
                        'Pending',
                        overview.counts.pending || 0,
                        'Within the configured window',
                      ],
                    ].map(([label, value, hint]) => (
                      <div key={label} className="ws-stat">
                        <span>{label}</span>
                        <strong>{value}</strong>
                        <small>{hint}</small>
                      </div>
                    ))}
                  </div>
                  <TransactionTable
                    overview={overview}
                    member={member}
                    exceptionsOnly={view === 'exceptions'}
                    busy={busy}
                    act={act}
                    refresh={refresh}
                    onOpen={(id) => void act(() => investigate(id))}
                  />
                </>
              ) : (
                <>
                  <WorkspaceLoading />
                  {error && (
                    <Button onClick={() => void act(refresh)}>
                      Retry loading
                    </Button>
                  )}
                </>
              )}
            </>
          )}
          {view === 'investigation' && (
            <>
              <div className="ws-heading">
                <div>
                  <span className="ws-eyebrow">EVIDENCE WORKBENCH</span>
                  <h1>Trace a transaction.</h1>
                  <p>
                    {canWrite
                      ? 'Run the engine against your saved source records.'
                      : 'Inspect results and source evidence from your workspace.'}
                  </p>
                </div>
              </div>
              <form
                className="ws-trace-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() => investigate(transactionId, canWrite));
                }}
              >
                <Input
                  aria-label="Transaction ID"
                  placeholder="TXN-5000"
                  required
                  value={transactionId}
                  onChange={(e) =>
                    setTransactionId(e.target.value.toUpperCase())
                  }
                />
                <Button disabled={busy}>
                  {canWrite ? 'Run trace' : 'View result'}
                  <ArrowUpRight />
                </Button>
              </form>
              {trace && (
                <>
                  <WorkspacePanel
                    title={trace.result.transactionId}
                    action={
                      canWrite ? (
                        <a
                          className="ws-text-link"
                          href={`/api/workspace/report/${encodeURIComponent(trace.result.transactionId)}`}
                        >
                          <Download size={15} /> Export report
                        </a>
                      ) : undefined
                    }
                  >
                    <div className="ws-result-top">
                      <StatusBadge status={trace.result.status} />
                      <span>
                        {money(trace.result.amount, trace.result.currency)}
                      </span>
                      <span>{trace.result.confidence}% confidence</span>
                    </div>
                    <h3>{trace.result.rootCause}</h3>
                    <p>{trace.explanation.explanation.whatHappened}</p>
                    <div className="ws-notice">
                      <strong>Recommended action</strong>
                      <p>{trace.explanation.explanation.recommendedAction}</p>
                    </div>
                    <small>
                      {trace.explanation.source === 'ai'
                        ? 'Gemini explanation grounded in the computed evidence'
                        : 'Deterministic explanation'}{' '}
                      · {trace.explanation.explanation.uncertainty}
                    </small>
                  </WorkspacePanel>
                  <TransactionTimeline
                    timeline={trace.result.timeline}
                    selectedStage={stage}
                    onStageSelect={setStage}
                    timeZone={member.timezone}
                  />
                  <EvidenceInspector
                    evidence={trace.result.evidence}
                    validationIssues={trace.result.validationIssues}
                    selectedStage={stage}
                    onStageSelect={setStage}
                    timeZone={member.timezone}
                  />
                  <CaseWorkspace
                    key={trace.result.transactionId}
                    transactionId={trace.result.transactionId}
                    member={member}
                    people={overview?.members || []}
                    busy={busy}
                    act={act}
                    onChanged={refresh}
                  />
                </>
              )}
            </>
          )}
          {view === 'imports' && canWrite && (
            <WorkspaceImports act={act} busy={busy} onImported={refresh} />
          )}
          {view === 'profile' && (
            <ProfileForm
              member={member}
              busy={busy}
              act={act}
              onSaved={(next) => {
                setMember(next);
                setPreference(next.theme);
              }}
            />
          )}
          {view === 'admin' &&
            (member.role === 'admin' ? (
              <WorkspaceAdmin member={member} busy={busy} act={act} />
            ) : (
              <WorkspacePanel title="Admin access required">
                <p>
                  Your role can view and investigate only the areas listed in
                  your navigation.
                </p>
              </WorkspacePanel>
            ))}
        </main>
        <footer className="ws-footer">
          <span>Settlement Trace AI · Evidence before conclusions</span>
          <span>Times shown in {member.timezone}</span>
        </footer>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`ws-badge ws-status-${status}`}>{status}</span>;
}
function TransactionTable({
  overview,
  member,
  exceptionsOnly,
  busy,
  act,
  refresh,
  onOpen,
}: {
  overview: Overview;
  member: WorkspaceMember;
  exceptionsOnly: boolean;
  busy: boolean;
  act: WorkspaceAction;
  refresh: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [issue, setIssue] = useState('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [sort, setSort] = useState('newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [bulkStatus, setBulkStatus] = useState<CaseStatus>('in_progress');
  const filtered = useMemo(
    () =>
      overview.transactions
        .filter(
          (t) =>
            (!exceptionsOnly ||
              !['successful', 'pending'].includes(t.status)) &&
            (status === 'all' || t.status === status) &&
            (issue === 'all' || t.issueCodes.includes(issue)) &&
            `${t.transactionId} ${t.merchant || ''} ${t.rootCause}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!from ||
              Boolean(
                t.transactionTimestamp &&
                dateKey(t.transactionTimestamp, member.timezone) >= from,
              )) &&
            (!until ||
              Boolean(
                t.transactionTimestamp &&
                dateKey(t.transactionTimestamp, member.timezone) <= until,
              )),
        )
        .sort((a, b) =>
          sort === 'amount'
            ? (b.amount || 0) - (a.amount || 0)
            : sort === 'confidence'
              ? a.confidence - b.confidence
              : (b.transactionTimestamp || '').localeCompare(
                  a.transactionTimestamp || '',
                ),
        ),
    [
      overview,
      exceptionsOnly,
      status,
      issue,
      query,
      from,
      until,
      sort,
      member.timezone,
    ],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 15) - 1),
  );
  const rows = filtered.slice(currentPage * 15, currentPage * 15 + 15);
  const editable = canAccess(member.role, 'comment');
  const shownSelected = selected.filter((id) =>
    filtered.some((t) => t.transactionId === id),
  );
  return (
    <WorkspacePanel
      title={exceptionsOnly ? 'Exception queue' : 'Transaction register'}
      action={<small>{filtered.length} transactions</small>}
    >
      <div className="ws-filters">
        <label className="ws-search" htmlFor="workspace-shell-1">
          <span className="sr-only">Search transactions</span>
          <Input
            id="workspace-shell-1"
            placeholder="Search ID, merchant, or root cause…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All statuses</option>
            {[
              'successful',
              'pending',
              'delayed',
              'failed',
              'mismatch',
              'uncertain',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Exception type</span>
          <select
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All types</option>
            {[...new Set(overview.transactions.flatMap((t) => t.issueCodes))]
              .sort()
              .map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll('_', ' ')}
                </option>
              ))}
          </select>
        </label>
        <label htmlFor="workspace-shell-2">
          <span>From</span>
          <Input
            id="workspace-shell-2"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label htmlFor="workspace-shell-3">
          <span>Through</span>
          <Input
            id="workspace-shell-3"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="amount">Largest amount</option>
            <option value="confidence">Lowest confidence</option>
          </select>
        </label>
      </div>
      {editable && shownSelected.length > 0 && (
        <div className="ws-bulk">
          <strong>{shownSelected.length} selected</strong>
          <select
            aria-label="Bulk case status"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as CaseStatus)}
          >
            {Object.entries(caseLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button
            disabled={busy || shownSelected.length > 100}
            onClick={() =>
              void act(async () => {
                await api('cases/bulk', 'PATCH', {
                  transactionIds: shownSelected,
                  status: bulkStatus,
                });
                setSelected([]);
                await refresh();
              }, 'Case statuses updated.')
            }
          >
            Apply status
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {editable && (
              <TableHead>
                <input
                  type="checkbox"
                  aria-label="Select this page"
                  checked={
                    rows.length > 0 &&
                    rows.every((t) => selected.includes(t.transactionId))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [
                            ...new Set([
                              ...selected,
                              ...rows.map((t) => t.transactionId),
                            ]),
                          ].slice(0, 100)
                        : selected.filter(
                            (id) => !rows.some((t) => t.transactionId === id),
                          ),
                    )
                  }
                />
              </TableHead>
            )}
            {[
              'Transaction / merchant',
              'Amount',
              'Result',
              'Case',
              'Captured',
              '',
            ].map((h, i) => (
              <TableHead key={i}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.transactionId}>
              {editable && (
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.transactionId}`}
                    checked={selected.includes(t.transactionId)}
                    disabled={
                      !selected.includes(t.transactionId) &&
                      selected.length >= 100
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, t.transactionId]
                          : selected.filter((id) => id !== t.transactionId),
                      )
                    }
                  />
                </TableCell>
              )}
              <TableCell>
                <button
                  className="ws-id"
                  onClick={() => onOpen(t.transactionId)}
                >
                  {t.transactionId}
                </button>
                <small className="ws-subtext">
                  {t.merchant || 'Merchant unavailable'}
                </small>
              </TableCell>
              <TableCell>{money(t.amount, t.currency)}</TableCell>
              <TableCell>
                <StatusBadge status={t.status} />
                <small className="ws-subtext ws-truncate" title={t.rootCause}>
                  {t.rootCause}
                </small>
              </TableCell>
              <TableCell>
                {caseLabels[t.caseStatus]}
                <small className="ws-subtext">
                  {overview.members.find((m) => m.id === t.assigneeId)
                    ?.display_name ||
                    overview.members.find((m) => m.id === t.assigneeId)
                      ?.email ||
                    'Unassigned'}
                </small>
              </TableCell>
              <TableCell>
                {date(t.transactionTimestamp, member.timezone)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  aria-label={`Inspect ${t.transactionId}`}
                  onClick={() => onOpen(t.transactionId)}
                >
                  <ArrowUpRight />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length && (
        <div className="ws-empty">
          <FileSearch size={30} />
          <h3>
            {overview.transactions.length
              ? 'No matching transactions'
              : 'Your evidence starts here'}
          </h3>
          <p>
            {overview.transactions.length
              ? 'Adjust the filters to see more results.'
              : editable
                ? 'Open Sources & imports to upload CSV records or sync Stripe sandbox.'
                : 'Your investigator can add source records to this workspace.'}
          </p>
        </div>
      )}
      <div className="ws-pagination">
        <span>
          Page {currentPage + 1} of{' '}
          {Math.max(1, Math.ceil(filtered.length / 15))}
        </span>
        <Button
          variant="outline"
          disabled={!currentPage}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={(currentPage + 1) * 15 >= filtered.length}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </Button>
      </div>
    </WorkspacePanel>
  );
}
function dateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(new Date(value));
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)?.value)
    .join('-');
}

function CaseWorkspace({
  transactionId,
  member,
  people,
  busy,
  act,
  onChanged,
}: {
  transactionId: string;
  member: WorkspaceMember;
  people: Person[];
  busy: boolean;
  act: WorkspaceAction;
  onChanged: () => Promise<void>;
}) {
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [status, setStatus] = useState<CaseStatus>('todo');
  const [assignee, setAssignee] = useState('');
  const [body, setBody] = useState('');
  const [reference, setReference] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    const data = await api<{ case: WorkspaceCase | null; notes: CaseNote[] }>(
      `case/${transactionId}`,
    );
    setNotes(data.notes);
    setStatus(data.case?.status || 'todo');
    setAssignee(data.case?.assignee_id || '');
    setLoaded(true);
    setLoadError('');
  };
  useEffect(() => {
    let active = true;
    void api<{ case: WorkspaceCase | null; notes: CaseNote[] }>(
      `case/${transactionId}`,
    )
      .then((data) => {
        if (active) {
          setNotes(data.notes);
          setStatus(data.case?.status || 'todo');
          setAssignee(data.case?.assignee_id || '');
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
    };
  }, [transactionId]);
  const editable = canAccess(member.role, 'comment');
  return (
    <WorkspacePanel title="Case workspace">
      {loadError && (
        <p className="ws-error" role="alert">
          {loadError}
          <Button onClick={() => void act(refresh)}>Retry</Button>
        </p>
      )}
      <form
        className="ws-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api(`case/${transactionId}`, 'PATCH', {
              status,
              assignee_id: assignee || null,
            });
            await onChanged();
          }, 'Case updated.');
        }}
      >
        <label>
          Status
          <select
            disabled={!editable || !loaded}
            value={status}
            onChange={(e) => setStatus(e.target.value as CaseStatus)}
          >
            {Object.entries(caseLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned to
          <select
            value={assignee}
            disabled={!editable || !loaded}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Unassigned</option>
            {people
              .filter((p) => p.role !== 'viewer')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name || p.email}
                </option>
              ))}
          </select>
        </label>
        {editable && (
          <Button type="submit" disabled={busy || !loaded}>
            Save case
          </Button>
        )}
      </form>
      <div className="ws-notes">
        {notes.map((n) => (
          <article key={n.id}>
            <div>
              <strong>
                {people.find((p) => p.id === n.author_id)?.display_name ||
                  people.find((p) => p.id === n.author_id)?.email ||
                  'Former member'}
              </strong>
              <time>{date(n.created_at, member.timezone)}</time>
            </div>
            <p>{n.body}</p>
            {n.reference_url && (
              <a
                className="ws-text-link"
                href={n.reference_url}
                target="_blank"
                rel="noreferrer"
              >
                Supporting reference <ArrowUpRight size={14} />
              </a>
            )}
          </article>
        ))}
        {loaded && !notes.length && (
          <p>No notes yet. Capture the evidence and the next step here.</p>
        )}
      </div>
      {editable && (
        <form
          className="ws-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(`case/${transactionId}/notes`, 'POST', {
                body,
                reference_url: reference,
              });
              setBody('');
              setReference('');
              await refresh();
            }, 'Note added.');
          }}
        >
          <label>
            Case note
            <textarea
              required
              maxLength={3000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What did you find?"
            />
          </label>
          <div className="ws-inline-form">
            <label>
              Mention a teammate
              <select
                aria-label="Mention a teammate"
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    setBody((v) => `${v}${v ? ' ' : ''}@${e.target.value} `);
                }}
              >
                <option value="">Choose a name…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.email}>
                    {p.display_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="workspace-shell-4">
              Reference link (optional)
              <Input
                id="workspace-shell-4"
                type="url"
                placeholder="https://…"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !loaded}>
              Add note
            </Button>
          </div>
          <small>
            Mentions are recorded in the case note; they do not send an email.
          </small>
        </form>
      )}
    </WorkspacePanel>
  );
}
function ProfileForm({
  member,
  busy,
  act,
  onSaved,
}: {
  member: WorkspaceMember;
  busy: boolean;
  act: WorkspaceAction;
  onSaved: (m: WorkspaceMember) => void;
}) {
  const [form, setForm] = useState({
    display_name: member.display_name,
    avatar_url: member.avatar_url,
    theme: member.theme,
    timezone: member.timezone,
    default_view: member.default_view,
  });
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">YOUR WORKSPACE, YOUR WAY</span>
          <h1>Profile & preferences.</h1>
          <p>Your saved preferences follow you across devices.</p>
        </div>
      </div>
      <WorkspacePanel title="Personal details">
        <form
          className="ws-form ws-profile"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const result = await api<{ member: WorkspaceMember }>(
                'profile',
                'PATCH',
                form,
              );
              onSaved(result.member);
            }, 'Profile and preferences saved.');
          }}
        >
          <div className="ws-notice">
            <strong>{member.email}</strong>
            <p>{member.role} · Google account</p>
          </div>
          <label htmlFor="workspace-shell-5">
            Display name
            <Input
              id="workspace-shell-5"
              required
              minLength={2}
              maxLength={80}
              value={form.display_name}
              onChange={(e) =>
                setForm({ ...form, display_name: e.target.value })
              }
            />
          </label>
          <label htmlFor="workspace-shell-6">
            Profile photo URL
            <Input
              id="workspace-shell-6"
              type="url"
              placeholder="https://…"
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
            />
          </label>
          <div className="ws-form-grid">
            <label>
              Theme
              <select
                value={form.theme}
                onChange={(e) =>
                  setForm({
                    ...form,
                    theme: e.target.value as typeof form.theme,
                  })
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Default dashboard
              <select
                value={form.default_view}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_view: e.target.value as typeof form.default_view,
                  })
                }
              >
                <option value="overview">Overview</option>
                <option value="exceptions">Exceptions</option>
              </select>
            </label>
          </div>
          <label htmlFor="workspace-shell-7">
            Timezone
            <Input
              id="workspace-shell-7"
              required
              value={form.timezone}
              list="workspace-timezones"
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
            <datalist id="workspace-timezones">
              {[
                'Asia/Kolkata',
                'UTC',
                'America/New_York',
                'America/Los_Angeles',
                'Europe/London',
                'Asia/Singapore',
                'Australia/Sydney',
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </datalist>
            <small>Use an IANA timezone, such as Asia/Kolkata.</small>
          </label>
          <Button type="submit" disabled={busy}>
            Save preferences
          </Button>
        </form>
      </WorkspacePanel>
      <Link className="ws-text-link" href="/">
        <ArrowLeft size={14} /> Back to public demo
      </Link>
    </>
  );
}
