-- =========================================================
-- INERGO · Catálogo de retos y administración
-- ---------------------------------------------------------
-- · public.challenges: catálogo global. Lo lee cualquiera (solo
--   los activos); solo los administradores crean, editan o desactivan.
-- · private.admin_emails: quién es administrador. Vive en un esquema
--   privado que la API no expone: no se puede leer ni tocar desde la app.
-- · public.is_admin(): dice si quien llama es administrador
--   (email confirmado y presente en private.admin_emails).
-- =========================================================

create extension if not exists citext with schema extensions;

-- ---------- Administradores ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.admin_emails (
  email      extensions.citext primary key,
  created_at timestamptz not null default now()
);
alter table private.admin_emails enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.admin_emails a on a.email = u.email::extensions.citext
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- Catálogo de retos ----------
create table public.challenges (
  id               text primary key,
  text             text not null,
  category         text not null,
  duration_type    text not null,
  duration_seconds integer,
  research_seconds integer,
  talk_seconds     integer,
  points           integer not null,
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,

  constraint challenges_id_format check (id ~ '^[a-z0-9-]{1,80}$'),
  constraint challenges_text_len check (char_length(btrim(text)) between 6 and 400),
  constraint challenges_category check (category in ('espontanea','experiencia','reflexion','conocimiento')),
  constraint challenges_type check (duration_type in ('timer','pending','research')),
  -- Cada categoría tiene su mecánica: Experiencia va a pendientes,
  -- Conocimiento investiga y habla, el resto usa cronómetro.
  constraint challenges_type_matches_category check (
    (category = 'experiencia'  and duration_type = 'pending')  or
    (category = 'conocimiento' and duration_type = 'research') or
    (category in ('espontanea','reflexion') and duration_type = 'timer')
  ),
  constraint challenges_durations check (
    (duration_type = 'timer'    and duration_seconds between 30 and 7200 and research_seconds is null and talk_seconds is null) or
    (duration_type = 'pending'  and duration_seconds is null and research_seconds is null and talk_seconds is null) or
    (duration_type = 'research' and duration_seconds is null and research_seconds between 60 and 3600 and talk_seconds between 15 and 600)
  ),
  constraint challenges_points check (points between 0 and 500)
);

create index challenges_active_order_idx on public.challenges (active, sort_order);
create index challenges_created_by_idx on public.challenges (created_by);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function public.set_updated_at();

-- ---------- Seguridad por filas ----------
alter table public.challenges enable row level security;
revoke insert, update, delete, truncate on public.challenges from anon;

create policy "Retos activos visibles para todos"
  on public.challenges for select to anon
  using (active);

create policy "Usuarios ven activos; admin ve todos"
  on public.challenges for select to authenticated
  using (active or (select public.is_admin()));

create policy "Solo admin crea retos"
  on public.challenges for insert to authenticated
  with check ((select public.is_admin()));

create policy "Solo admin edita retos"
  on public.challenges for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Solo admin borra retos"
  on public.challenges for delete to authenticated
  using ((select public.is_admin()));
