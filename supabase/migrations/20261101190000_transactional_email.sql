alter table public.profiles
  add column if not exists email text;

update public.profiles as profile
set email = lower(auth_user.email)
from auth.users as auth_user
where auth_user.id = profile.id
  and profile.email is distinct from lower(auth_user.email);

create unique index if not exists profiles_email_unique
  on public.profiles (email)
  where email is not null;

revoke update on public.profiles from authenticated;
grant update (full_name, username, phone_number) on public.profiles to authenticated;

create table if not exists public.welcome_email_events (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);

alter table public.welcome_email_events enable row level security;
revoke all on public.welcome_email_events from public, anon, authenticated;
grant all on public.welcome_email_events to service_role;

create table if not exists public.password_recovery_codes (
  email text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  requests_in_window smallint not null default 1 check (requests_in_window between 1 and 5),
  window_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.password_recovery_codes enable row level security;
revoke all on public.password_recovery_codes from public, anon, authenticated;
grant all on public.password_recovery_codes to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, username, phone_number, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    nullif(new.raw_user_meta_data ->> 'phone_number', ''),
    lower(new.email)
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

create or replace function public.handle_user_email_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(new.email)
  where id = new.id;

  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_update();

create or replace function public.issue_password_recovery_code(
  p_email text,
  p_user_id uuid,
  p_code_hash text,
  p_expires_at timestamptz,
  p_requested_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_requested_at timestamptz;
  request_window_started_at timestamptz;
  requests_in_window smallint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(lower(p_email))::bigint
  );

  select recovery.created_at, recovery.window_started_at, recovery.requests_in_window
  into last_requested_at, request_window_started_at, requests_in_window
  from public.password_recovery_codes as recovery
  where recovery.email = lower(p_email)
  for update;

  if last_requested_at is not null
    and last_requested_at > p_requested_at - interval '60 seconds' then
    return false;
  end if;
  if request_window_started_at > p_requested_at - interval '1 hour'
    and requests_in_window >= 5 then
    return false;
  end if;

  insert into public.password_recovery_codes as current_request (
    email,
    user_id,
    code_hash,
    expires_at,
    attempts,
    requests_in_window,
    window_started_at,
    created_at
  )
  values (
    lower(p_email),
    p_user_id,
    p_code_hash,
    p_expires_at,
    0,
    1,
    p_requested_at,
    p_requested_at
  )
  on conflict (email) do update
  set user_id = excluded.user_id,
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      requests_in_window = case
        when current_request.window_started_at
          <= p_requested_at - interval '1 hour' then 1
        else current_request.requests_in_window + 1
      end,
      window_started_at = case
        when current_request.window_started_at
          <= p_requested_at - interval '1 hour' then p_requested_at
        else current_request.window_started_at
      end,
      created_at = excluded.created_at;

  return true;
end;
$$;

create or replace function public.consume_password_recovery_code(
  p_email text,
  p_code_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery public.password_recovery_codes%rowtype;
begin
  select * into recovery
  from public.password_recovery_codes
  where email = lower(p_email)
  for update;

  if not found
    or recovery.expires_at <= now()
    or recovery.attempts >= 5 then
    return null;
  end if;

  if recovery.code_hash <> p_code_hash then
    update public.password_recovery_codes
    set attempts = attempts + 1
    where email = lower(p_email);
    return null;
  end if;

  delete from public.password_recovery_codes
  where email = lower(p_email);

  return recovery.user_id;
end;
$$;

revoke all on function public.issue_password_recovery_code(
  text, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.issue_password_recovery_code(
  text, uuid, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.consume_password_recovery_code(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_password_recovery_code(text, text)
  to service_role;
