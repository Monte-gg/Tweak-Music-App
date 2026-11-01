create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  username text,
  phone_number text,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or (
      username = lower(username)
      and username ~ '^[a-z0-9._]{3,20}$'
    )
  ),
  constraint profiles_phone_format check (
    phone_number is null or phone_number ~ '^\+254[17][0-9]{8}$'
  )
);

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, update on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, username, phone_number)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    nullif(new.raw_user_meta_data ->> 'phone_number', '')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
