import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRole } from './workspace-types';
import { canAccess } from './workspace-types';
const state = vi.hoisted(() => ({
  role: 'viewer' as WorkspaceRole,
  configured: true,
  db: vi.fn(),
}));
vi.mock('@/lib/server/workspace-auth', async (original) => {
  const actual = await original<typeof import('./server/workspace-auth')>();
  return {
    ...actual,
    workspaceConfigured: () => state.configured,
    authContext: () => ({
      headers: new Headers({ 'Cache-Control': 'private, no-store' }),
      client: { auth: { signOut: vi.fn() } },
    }),
    consumeLimit: vi.fn(),
    requireMember: async (
      _context: unknown,
      permission: Parameters<typeof canAccess>[1],
    ) => {
      if (!canAccess(state.role, permission))
        throw new actual.WorkspaceError(
          403,
          'Your role does not allow this action.',
        );
      return {
        db: { from: state.db },
        member: { id: 'member', role: state.role },
        user: {},
      };
    },
  };
});
import { GET, PATCH, POST } from '@/app/api/workspace/[...path]/route';
beforeEach(() => {
  state.role = 'viewer';
  state.configured = true;
  state.db.mockReset();
  vi.stubEnv('APP_URL', 'https://workspace.example');
});
describe('workspace endpoint permission checks', () => {
  it.each([
    'trace',
    'imports',
    'stripe',
    'extract',
    'scan',
    'case/TXN-1000/notes',
    'admin/members',
  ])('blocks a Viewer POST to %s before database access', async (path) => {
    const response = await POST(
      new Request(`https://workspace.example/api/workspace/${path}`, {
        method: 'POST',
        headers: { origin: 'https://workspace.example' },
        body: '{}',
      }),
      { params: Promise.resolve({ path: path.split('/') }) },
    );
    expect(response.status).toBe(403);
    expect(state.db).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it.each([
    'case/TXN-1000',
    'cases/bulk',
    'admin/settings',
    'admin/members/123',
  ])('blocks a Viewer PATCH to %s', async (path) => {
    const response = await PATCH(
      new Request(`https://workspace.example/api/workspace/${path}`, {
        method: 'PATCH',
        headers: { origin: 'https://workspace.example' },
        body: '{}',
      }),
      { params: Promise.resolve({ path: path.split('/') }) },
    );
    expect(response.status).toBe(403);
    expect(state.db).not.toHaveBeenCalled();
  });
  it('blocks Viewer report export and Investigator administration', async () => {
    expect(
      (
        await GET(
          new Request(
            'https://workspace.example/api/workspace/report/TXN-1000',
          ),
          { params: Promise.resolve({ path: ['report', 'TXN-1000'] }) },
        )
      ).status,
    ).toBe(403);
    state.role = 'investigator';
    expect(
      (
        await GET(
          new Request('https://workspace.example/api/workspace/admin'),
          { params: Promise.resolve({ path: ['admin'] }) },
        )
      ).status,
    ).toBe(403);
  });
  it('does not allow a profile patch to smuggle an Admin role', async () => {
    const response = await PATCH(
      new Request('https://workspace.example/api/workspace/profile', {
        method: 'PATCH',
        headers: { origin: 'https://workspace.example' },
        body: JSON.stringify({
          display_name: 'Test',
          avatar_url: '',
          theme: 'dark',
          timezone: 'UTC',
          default_view: 'overview',
          role: 'admin',
        }),
      }),
      { params: Promise.resolve({ path: ['profile'] }) },
    );
    expect(response.status).toBe(422);
    expect(state.db).not.toHaveBeenCalled();
  });
  it('reports setup pending without revealing configuration values', async () => {
    state.configured = false;
    const response = await GET(
      new Request('https://workspace.example/api/workspace/session'),
      { params: Promise.resolve({ path: ['session'] }) },
    );
    expect(await response.json()).toEqual({ configured: false, member: null });
  });
});
