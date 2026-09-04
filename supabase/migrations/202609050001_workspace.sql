-- Apply once in the Supabase SQL editor. Auth owns auth.users and its sessions.
create type public.workspace_role as enum ('viewer', 'investigator', 'admin');
create type public.case_status as enum ('todo', 'in_progress', 'resolved');
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique check (email = lower(email)), display_name text not null default '', avatar_url text not null default '',
  role public.workspace_role not null default 'viewer', active boolean not null default true,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  timezone text not null default 'Asia/Kolkata', default_view text not null default 'overview' check (default_view in ('overview','exceptions')),
  last_login_at timestamptz, trace_count integer not null default 0, created_at timestamptz not null default now()
);
create table public.workspace_settings (
  id integer primary key check (id = 1), bank_sla_minutes integer not null default 180 check (bank_sla_minutes between 1 and 43200),
  ledger_sla_minutes integer not null default 30 check (ledger_sla_minutes between 1 and 43200), gateway_sla_minutes integer not null default 120 check (gateway_sla_minutes between 1 and 43200),
  alert_after_minutes integer not null default 2880 check (alert_after_minutes between 1 and 43200), alerts_enabled boolean not null default false
);
create table public.workspace_records (
  id uuid primary key default gen_random_uuid(), source text not null check (source in ('gateway','settlement','bank','ledger')),
  transaction_id text not null, source_key text not null, payload jsonb not null, imported_by uuid references public.workspace_members(id),
  imported_at timestamptz not null default now(), provenance text not null default 'csv', unique(source, source_key)
);
create index workspace_records_transaction on public.workspace_records(transaction_id);
create table public.workspace_cases (
  transaction_id text primary key, status public.case_status not null default 'todo', assignee_id uuid references public.workspace_members(id),
  updated_by uuid references public.workspace_members(id), updated_at timestamptz not null default now()
);
create table public.workspace_notes (
  id uuid primary key default gen_random_uuid(), transaction_id text not null, author_id uuid not null references public.workspace_members(id),
  body text not null check (length(body) between 1 and 3000), reference_url text not null default '', created_at timestamptz not null default now()
);
create index workspace_notes_transaction on public.workspace_notes(transaction_id, created_at);
create table public.workspace_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.workspace_members(id), action text not null,
  transaction_id text, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index workspace_audit_time on public.workspace_audit(created_at desc);
create table public.workspace_scans (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.workspace_members(id), transaction_count integer not null,
  exception_count integer not null, counts jsonb not null, created_at timestamptz not null default now()
);
create table public.workspace_alerts (
  id uuid primary key default gen_random_uuid(), transaction_id text not null, fingerprint text not null unique,
  payload jsonb not null, delivered_at timestamptz, attempts integer not null default 0,
  claimed_until timestamptz, created_at timestamptz not null default now()
);
create table public.workspace_rate_limits (key text primary key, hits integer not null default 1, expires_at timestamptz not null);

-- All data access is through checked server endpoints. No browser credential may
-- read or mutate workspace tables, roles, imports or audit records directly.
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_records enable row level security;
alter table public.workspace_cases enable row level security;
alter table public.workspace_notes enable row level security;
alter table public.workspace_audit enable row level security;
alter table public.workspace_scans enable row level security;
alter table public.workspace_alerts enable row level security;
alter table public.workspace_rate_limits enable row level security;
revoke all on public.workspace_members,public.workspace_settings,public.workspace_records,public.workspace_cases,public.workspace_notes,public.workspace_audit,public.workspace_scans,public.workspace_alerts,public.workspace_rate_limits from anon, authenticated;
grant all on public.workspace_members,public.workspace_settings,public.workspace_records,public.workspace_cases,public.workspace_notes,public.workspace_audit,public.workspace_scans,public.workspace_alerts,public.workspace_rate_limits to service_role;

create function public.workspace_login(p_user uuid, p_email text, p_name text, p_avatar text, p_bootstrap boolean)
returns public.workspace_members language plpgsql security definer set search_path = public as $$
declare m public.workspace_members;
begin
  perform pg_advisory_xact_lock(hashtext('workspace-login'));
  select * into m from workspace_members where email=lower(p_email) for update;
  if m.id is null and p_bootstrap then
    insert into workspace_members(email,role,display_name,avatar_url) values(lower(p_email),'admin',left(p_name,80),p_avatar) returning * into m;
  end if;
  if m.id is null or not m.active then raise exception 'Workspace access is not enabled'; end if;
  if m.auth_user_id is not null and m.auth_user_id <> p_user then raise exception 'Identity does not match invitation'; end if;
  update workspace_members set auth_user_id=p_user,last_login_at=now(),display_name=case when display_name='' then left(p_name,80) else display_name end where id=m.id returning * into m;
  insert into workspace_audit(actor_id,action) values(m.id,'sign_in');
  return m;
end $$;

create function public.workspace_update_member(p_actor uuid,p_member uuid,p_role public.workspace_role,p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('workspace-role-update'));
  if not exists(select 1 from workspace_members where id=p_actor and role='admin' and active) then raise exception 'Admin required'; end if;
  if p_member=p_actor and (p_role<>'admin' or not p_active) then raise exception 'You cannot remove your own admin access'; end if;
  if exists(select 1 from workspace_members where id=p_member and role='admin' and active) and (p_role<>'admin' or not p_active) and (select count(*) from workspace_members where role='admin' and active)<2 then raise exception 'The last admin must remain active'; end if;
  update workspace_members set role=p_role,active=p_active where id=p_member;
  if not found then raise exception 'Member not found'; end if;
  insert into workspace_audit(actor_id,action,detail) values(p_actor,'member_updated',jsonb_build_object('member_id',p_member,'role',p_role,'active',p_active));
end $$;

create function public.workspace_import(p_actor uuid,p_source text,p_records jsonb,p_provenance text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if p_actor is null then
    if p_provenance <> 'stripe_sandbox_scheduled' then raise exception 'Invalid system import'; end if;
  elsif not exists(select 1 from workspace_members where id=p_actor and role in ('admin','investigator') and active) then raise exception 'Investigator required'; end if;
  if p_source not in ('gateway','settlement','bank','ledger') or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records) not between 1 and 1000 then raise exception 'Invalid import'; end if;
  perform pg_advisory_xact_lock(hashtext('workspace-import'));
  insert into workspace_records(source,transaction_id,source_key,payload,imported_by,provenance)
  select p_source,r->>'transactionId',case p_source when 'gateway' then r->>'transactionId' when 'settlement' then r->>'settlementId' when 'bank' then r->>'bankReference' else r->>'ledgerReference' end,r,p_actor,p_provenance from jsonb_array_elements(p_records) r
  on conflict(source,source_key) do update set transaction_id=excluded.transaction_id,payload=excluded.payload,imported_by=excluded.imported_by,imported_at=now(),provenance=excluded.provenance;
  get diagnostics v_count = row_count;
  if (select count(*) from workspace_records)>10000 then raise exception 'Workspace record limit reached'; end if;
  insert into workspace_audit(actor_id,action,detail) values(p_actor,'records_imported',jsonb_build_object('source',p_source,'count',v_count,'provenance',p_provenance));
  return v_count;
end $$;

create function public.workspace_record_trace(p_actor uuid,p_transaction text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update workspace_members set trace_count=trace_count+1 where id=p_actor and active and role in ('investigator','admin');
  if not found then raise exception 'Investigator required'; end if;
  insert into workspace_audit(actor_id,action,transaction_id) values(p_actor,'trace',p_transaction);
end $$;

create function public.workspace_consume_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into workspace_rate_limits(key,hits,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set hits=case when workspace_rate_limits.expires_at<now() then 1 else workspace_rate_limits.hits+1 end,
  expires_at=case when workspace_rate_limits.expires_at<now() then now()+make_interval(secs=>p_seconds) else workspace_rate_limits.expires_at end returning hits into n;
  return n<=p_limit;
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; revoke it on each RPC.
revoke all on function public.workspace_login(uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.workspace_update_member(uuid,uuid,public.workspace_role,boolean) from public,anon,authenticated;
revoke all on function public.workspace_import(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.workspace_record_trace(uuid,text) from public,anon,authenticated;
revoke all on function public.workspace_consume_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.workspace_login(uuid,text,text,text,boolean),public.workspace_update_member(uuid,uuid,public.workspace_role,boolean),public.workspace_import(uuid,text,jsonb,text),public.workspace_record_trace(uuid,text),public.workspace_consume_limit(text,integer,integer) to service_role;

create function public.workspace_claim_alerts() returns setof public.workspace_alerts
language plpgsql security definer set search_path = public as $$
begin
  return query update workspace_alerts set claimed_until=now()+interval '2 minutes', attempts=attempts+1
  where id in (select id from workspace_alerts where delivered_at is null and attempts<5 and (claimed_until is null or claimed_until<now()) order by created_at limit 10 for update skip locked)
  returning *;
end $$;
revoke all on function public.workspace_claim_alerts() from public,anon,authenticated;
grant execute on function public.workspace_claim_alerts() to service_role;
