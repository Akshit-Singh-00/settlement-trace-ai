'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  WorkspacePanel,
  WorkspaceLoading,
  type WorkspaceAction,
} from '@/components/workspace-shell';
import {
  workspaceApi as api,
  workspaceDate as date,
} from '@/lib/workspace-client';
import type {
  AuditEntry,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSettings,
} from '@/lib/workspace-types';
type AdminData = {
  members: WorkspaceMember[];
  logs: AuditEntry[];
  auditCount: number;
  settings: WorkspaceSettings;
  connections: {
    stripe: boolean;
    documents: boolean;
    alerts: boolean;
    scheduled: boolean;
  };
};
export function WorkspaceAdmin({
  member,
  busy,
  act,
}: {
  member: WorkspaceMember;
  busy: boolean;
  act: WorkspaceAction;
}) {
  const [data, setData] = useState<AdminData | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [memberPage, setMemberPage] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('viewer');
  const [error, setError] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const refresh = async () => {
    const next = await api<AdminData>(
      `admin?page=${page}&search=${encodeURIComponent(auditSearch)}`,
    );
    setData(next);
    setSettings(next.settings);
    setError('');
  };
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api<AdminData>(
        `admin?page=${page}&search=${encodeURIComponent(auditSearch)}`,
      )
        .then((next) => {
          if (active) {
            setData(next);
            setSettings((s) => s || next.settings);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, auditSearch]);
  if (!data || !settings)
    return (
      <>
        {error && (
          <div className="ws-error" role="alert">
            {error}
            <Button onClick={() => void act(refresh)}>Retry</Button>
          </div>
        )}
        <WorkspaceLoading />
      </>
    );
  const filtered = data.members.filter((m) =>
    `${m.email} ${m.display_name} ${m.role}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const currentPage = Math.min(
    memberPage,
    Math.max(0, Math.ceil(filtered.length / 10) - 1),
  );
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">WORKSPACE CONTROL</span>
          <h1>Administration.</h1>
          <p>Manage access, settlement windows, and the audit trail.</p>
        </div>
      </div>
      {error && (
        <div className="ws-error" role="alert">
          {error}
        </div>
      )}
      <WorkspacePanel
        title="Team members"
        action={<span className="ws-badge">{data.members.length} members</span>}
      >
        <form
          className="ws-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('admin/members', 'POST', { email, role });
              setEmail('');
              await refresh();
            }, 'Access granted. Ask the member to sign in with this Google email.');
          }}
        >
          <label htmlFor="workspace-admin-1">
            Invite Google email
            <Input
              id="workspace-admin-1"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              <option value="viewer">Viewer</option>
              <option value="investigator">Investigator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" disabled={busy}>
            Grant access
          </Button>
        </form>
        <small>
          Viewer: inspect evidence · Investigator: import, trace, export and
          manage cases · Admin: manage people and settings. Invitations grant
          access without sending email.
        </small>
        <Input
          className="ws-admin-search"
          aria-label="Search members"
          placeholder="Search name, email, or role…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setMemberPage(0);
          }}
        />
        <Table>
          <TableHeader>
            <TableRow>
              {['Member', 'Role', 'Last login', 'Traces', 'Access'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered
              .slice(currentPage * 10, currentPage * 10 + 10)
              .map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <strong>{m.display_name || 'Invitation pending'}</strong>
                    <small className="ws-subtext">
                      {m.email}
                      {m.id === member.id ? ' · You' : ''}
                    </small>
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={busy || m.id === member.id}
                      onChange={(e) =>
                        void act(async () => {
                          await api(`admin/members/${m.id}`, 'PATCH', {
                            role: e.target.value,
                            active: m.active,
                          });
                          await refresh();
                        }, 'Member role updated.')
                      }
                    >
                      <option value="viewer">Viewer</option>
                      <option value="investigator">Investigator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    {date(m.last_login_at, member.timezone)}
                  </TableCell>
                  <TableCell>{m.trace_count}</TableCell>
                  <TableCell>
                    <Button
                      variant={m.active ? 'outline' : 'secondary'}
                      disabled={busy || m.id === member.id}
                      onClick={() =>
                        void act(
                          async () => {
                            await api(`admin/members/${m.id}`, 'PATCH', {
                              role: m.role,
                              active: !m.active,
                            });
                            await refresh();
                          },
                          m.active ? 'Access disabled.' : 'Access restored.',
                        )
                      }
                    >
                      {m.active ? 'Disable access' : 'Restore access'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <div className="ws-pagination">
          <span>{filtered.length} matching members</span>
          <Button
            variant="outline"
            disabled={!currentPage}
            onClick={() => setMemberPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={(currentPage + 1) * 10 >= filtered.length}
            onClick={() => setMemberPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </WorkspacePanel>
      <div className="ws-import-grid">
        <WorkspacePanel title="Settlement SLAs">
          <form
            className="ws-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api('admin/settings', 'PATCH', settings);
                await refresh();
              }, 'SLAs saved. New traces and scans use these windows.');
            }}
          >
            {[
              ['gateway_sla_minutes', 'Capture to settlement'],
              ['bank_sla_minutes', 'Settlement to bank'],
              ['ledger_sla_minutes', 'Bank to ledger'],
              ['alert_after_minutes', 'Alert after a stage has waited'],
            ].map(([key, label]) => (
              <label key={key} htmlFor={`ws-input-${key}`}>
                {label} (minutes)
                <Input
                  id={`ws-input-${key}`}
                  type="number"
                  min={1}
                  max={43200}
                  required
                  value={settings[key as keyof WorkspaceSettings] as number}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <label className="ws-check">
              <input
                type="checkbox"
                checked={settings.alerts_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, alerts_enabled: e.target.checked })
                }
              />
              Send daily SLA alerts to an external webhook
            </label>
            <small>
              Exceptions are always available inside the workspace. Enable this
              only to send alerts to a configured webhook. Duplicate alerts for
              the same transaction and cause are suppressed.
            </small>
            <Button disabled={busy} type="submit">
              Save SLA settings
            </Button>
          </form>
        </WorkspacePanel>
        <WorkspacePanel title="Service connections">
          {[
            ['stripe', 'Stripe sandbox'],
            ['documents', 'Gemini documents'],
            ['scheduled', 'Daily scan'],
            ['alerts', 'Alert webhook'],
          ].map(([key, label]) => (
            <div className="ws-connection" key={key}>
              <span>{label}</span>
              <span
                className={`ws-badge ${data.connections[key as keyof AdminData['connections']] ? 'ws-status-successful' : 'ws-status-pending'}`}
              >
                {data.connections[key as keyof AdminData['connections']]
                  ? 'Configured'
                  : key === 'alerts'
                    ? 'Optional'
                    : 'Needs setup'}
              </span>
            </div>
          ))}
          <p>
            The daily job runs around 07:30 India time on Vercel. The latest run
            appears on Overview.
          </p>
          <small>
            Configured means credentials are present. A sync, extraction, or job
            run verifies the connection. Secrets are managed in deployment
            settings.
          </small>
        </WorkspacePanel>
      </div>
      <WorkspacePanel
        title="Activity audit"
        action={<small>{data.auditCount} events</small>}
      >
        <Input
          aria-label="Search audit events"
          placeholder="Search action or transaction ID…"
          value={auditSearch}
          onChange={(e) => {
            setAuditSearch(e.target.value);
            setPage(0);
          }}
        />
        <Table>
          <TableHeader>
            <TableRow>
              {['Time', 'Member', 'Action', 'Transaction'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{date(log.created_at, member.timezone)}</TableCell>
                <TableCell>
                  {log.actor_id
                    ? data.members.find((m) => m.id === log.actor_id)?.email ||
                      'Former member'
                    : 'Scheduled system job'}
                </TableCell>
                <TableCell>
                  {log.action.replaceAll('_', ' ')}
                  {Object.keys(log.detail).length > 0 && (
                    <details>
                      <summary>Details</summary>
                      <pre className="ws-audit-detail">
                        {JSON.stringify(log.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </TableCell>
                <TableCell>{log.transaction_id || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="ws-pagination">
          <span>
            Page {page + 1} of {Math.max(1, Math.ceil(data.auditCount / 25))}
          </span>
          <Button
            variant="outline"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={(page + 1) * 25 >= data.auditCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </WorkspacePanel>
    </>
  );
}
