-- =========================================================
-- INERGO · MVP: compromiso en el servidor
-- ---------------------------------------------------------
-- · profiles: identidad pública mínima (privada por defecto).
-- · draws: cada reto asignado. El sorteo, el inicio, la entrega y el
--   abandono solo ocurren a través de funciones de la base de datos:
--   el móvil no puede crear, cambiar ni borrar filas directamente.
-- · weekly_challenges: el «Barco de la semana».
-- · reports: denuncias de pruebas.
-- · legacy_imports: progreso que ya existía en el móvil (v1/v2).
-- Regla central: como mucho UN reto abierto (revelado o empezado) por
-- persona, garantizado por un índice único, no por la app.
-- =========================================================

-- ---------- Catálogo: nivel de riesgo ----------
alter table public.challenges
  add column if not exists risk_level text not null default 'bajo'
  constraint challenges_risk_level check (risk_level in ('bajo','medio','alto'));

-- ---------- Perfiles ----------
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           extensions.citext unique,
  display_name       text,
  bio                text,
  avatar_url         text,
  is_public          boolean not null default false,
  adult_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username::text ~ '^[a-z0-9_.]{3,24}$'),
  constraint profiles_display_name_len check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 160),
  constraint profiles_avatar_https check (avatar_url is null or avatar_url ~ '^https://')
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cada cuenta (también las anónimas) nace con su perfil vacío.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
revoke insert, delete, truncate on public.profiles from anon, authenticated;
-- Solo se pueden cambiar estas columnas; la edad confirmada va por función.
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, bio, avatar_url, is_public) on public.profiles to authenticated;

create policy "Ves tu perfil y los públicos"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or is_public);

create policy "Visitantes ven perfiles públicos"
  on public.profiles for select to anon
  using (is_public);

create policy "Editas solo tu perfil"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------- Barco de la semana ----------
create table public.weekly_challenges (
  id           uuid primary key default gen_random_uuid(),
  challenge_id text not null references public.challenges(id),
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint weekly_title_len check (char_length(btrim(title)) between 3 and 80),
  constraint weekly_dates check (ends_at > starts_at)
);
create index weekly_challenges_dates_idx on public.weekly_challenges (starts_at, ends_at);
create index weekly_challenges_challenge_idx on public.weekly_challenges (challenge_id);
create index weekly_challenges_created_by_idx on public.weekly_challenges (created_by);

alter table public.weekly_challenges enable row level security;
revoke insert, update, delete, truncate on public.weekly_challenges from anon;

create policy "Barcos visibles para todos"
  on public.weekly_challenges for select to anon, authenticated
  using (true);
create policy "Solo admin crea barcos"
  on public.weekly_challenges for insert to authenticated
  with check ((select public.is_admin()));
create policy "Solo admin edita barcos"
  on public.weekly_challenges for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Solo admin borra barcos"
  on public.weekly_challenges for delete to authenticated
  using ((select public.is_admin()));

-- ---------- Retos asignados ----------
create table public.draws (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  challenge_id   text not null references public.challenges(id),
  weekly_id      uuid references public.weekly_challenges(id) on delete set null,
  -- Copia del reto tal como salió (si luego se edita el catálogo, no cambia).
  challenge_text text not null,
  category       text not null,
  points         integer not null,
  status         text not null default 'revealed',
  revealed_at    timestamptz not null default now(),
  started_at     timestamptz,
  pending_at     timestamptz,
  completed_at   timestamptz,
  abandoned_at   timestamptz,
  abandon_reason text,
  evidence_url   text,
  note           text,
  share_in_crew  boolean not null default false,
  xp             integer not null default 0,
  constraint draws_status check (status in ('revealed','started','pending','completed','abandoned')),
  constraint draws_category check (category in ('espontanea','experiencia','reflexion','conocimiento')),
  constraint draws_reason check (
    (status = 'abandoned' and abandon_reason in ('peligroso','imposible','limite_personal','prueba_admin')) or
    (status <> 'abandoned' and abandon_reason is null)
  ),
  -- (Postgres no admite repeticiones {n,m} > 255: la longitud se limita aparte.)
  constraint draws_evidence check (
    evidence_url is null or (
      char_length(evidence_url) <= 500
      and evidence_url ~* '^https://([a-z0-9-]+\.)?(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)/[^\s]+$'
    )
  ),
  constraint draws_note_len check (note is null or char_length(note) <= 280),
  constraint draws_xp check (xp between 0 and 500)
);

-- La regla central, garantizada por la base de datos.
create unique index draws_one_open_per_user on public.draws (user_id) where status in ('revealed','started');
create index draws_user_idx on public.draws (user_id, revealed_at desc);
create index draws_challenge_idx on public.draws (challenge_id);
create index draws_weekly_idx on public.draws (weekly_id, completed_at) where status = 'completed';

alter table public.draws enable row level security;
-- Nadie escribe directamente: todo pasa por las funciones de abajo.
revoke insert, update, delete, truncate on public.draws from anon, authenticated;

create policy "Ves tus retos"
  on public.draws for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Denuncias ----------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draw_id     uuid not null references public.draws(id) on delete cascade,
  reason      text not null,
  details     text,
  created_at  timestamptz not null default now(),
  constraint reports_reason check (reason in ('peligroso','ofensivo','spam','menor','otro')),
  constraint reports_details_len check (details is null or char_length(details) <= 500),
  constraint reports_one_per_reporter unique (reporter_id, draw_id)
);
create index reports_draw_idx on public.reports (draw_id);

alter table public.reports enable row level security;
revoke update, delete, truncate on public.reports from anon, authenticated;
revoke insert on public.reports from anon;

create policy "Denuncias: crea quien tiene sesión"
  on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy "Denuncias: solo admin las lee"
  on public.reports for select to authenticated
  using ((select public.is_admin()));

-- ---------- Progreso que ya estaba en el móvil ----------
create table public.legacy_imports (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  xp          integer not null,
  completed   integer not null,
  stats       jsonb not null,
  imported_at timestamptz not null default now(),
  constraint legacy_xp check (xp between 0 and 50000),
  constraint legacy_completed check (completed between 0 and 2000)
);
alter table public.legacy_imports enable row level security;
revoke insert, update, delete, truncate on public.legacy_imports from anon, authenticated;
create policy "Ves tu progreso importado"
  on public.legacy_imports for select to authenticated
  using (user_id = (select auth.uid()));

-- =========================================================
-- Funciones (la única forma de cambiar draws)
-- =========================================================

-- Sortea un reto o devuelve el que ya tienes abierto.
create or replace function public.draw_challenge(p_category text default 'todos')
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_open public.draws;
  v_ch   public.challenges;
  v_row  public.draws;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if p_category not in ('todos','espontanea','experiencia','reflexion','conocimiento') then
    raise exception 'categoria_invalida' using errcode = '22023';
  end if;

  -- Regla central: si ya hay un reto abierto, es ese.
  select * into v_open from public.draws
   where user_id = v_uid and status in ('revealed','started')
   for update;
  if found then return v_open; end if;

  select c.* into v_ch
    from public.challenges c
   where c.active
     and (p_category = 'todos' or c.category = p_category)
     and c.risk_level <> 'alto'
     -- ni los últimos 6 que te han salido, ni los que tienes apuntados
     and c.id not in (
       select d.challenge_id from public.draws d
        where d.user_id = v_uid
          and (d.status = 'pending' or d.revealed_at > now() - interval '60 days')
        order by d.revealed_at desc limit 6)
     and c.id not in (select d.challenge_id from public.draws d where d.user_id = v_uid and d.status = 'pending')
   order by random()
   limit 1;

  -- Si el filtro de repetidos deja la categoría vacía, se permite repetir (salvo apuntados).
  if not found then
    select c.* into v_ch from public.challenges c
     where c.active and (p_category = 'todos' or c.category = p_category) and c.risk_level <> 'alto'
       and c.id not in (select d.challenge_id from public.draws d where d.user_id = v_uid and d.status = 'pending')
     order by random() limit 1;
  end if;
  if not found then raise exception 'sin_retos' using errcode = 'P0002'; end if;

  insert into public.draws (user_id, challenge_id, challenge_text, category, points)
  values (v_uid, v_ch.id, v_ch.text, v_ch.category, v_ch.points)
  returning * into v_row;
  return v_row;
exception
  when unique_violation then
    -- Dos giros a la vez desde dos pestañas: gana el primero.
    select * into v_row from public.draws where user_id = v_uid and status in ('revealed','started');
    return v_row;
end;
$$;

-- Te subes al Barco de la semana: el reto queda fijado como tu reto abierto.
create or replace function public.join_weekly(p_weekly_id uuid)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_w   public.weekly_challenges;
  v_ch  public.challenges;
  v_row public.draws;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  select * into v_w from public.weekly_challenges
   where id = p_weekly_id and now() between starts_at and ends_at;
  if not found then raise exception 'barco_cerrado' using errcode = 'P0002'; end if;
  if exists (select 1 from public.draws where user_id = v_uid and status in ('revealed','started')) then
    raise exception 'reto_abierto' using errcode = '23505';
  end if;
  if exists (select 1 from public.draws where user_id = v_uid and weekly_id = p_weekly_id) then
    raise exception 'ya_en_el_barco' using errcode = '23505';
  end if;
  select * into v_ch from public.challenges where id = v_w.challenge_id;
  insert into public.draws (user_id, challenge_id, weekly_id, challenge_text, category, points)
  values (v_uid, v_ch.id, v_w.id, v_ch.text, v_ch.category, v_ch.points)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.start_draw(p_draw_id uuid)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.draws;
begin
  update public.draws set status = 'started', started_at = coalesce(started_at, now())
   where id = p_draw_id and user_id = auth.uid() and status in ('revealed','started')
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

-- Experiencia: se apunta en Pendientes y libera el hueco para otro giro.
create or replace function public.save_pending(p_draw_id uuid)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.draws;
begin
  update public.draws set status = 'pending', pending_at = now()
   where id = p_draw_id and user_id = auth.uid() and status in ('revealed','started') and category = 'experiencia'
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

create or replace function public.complete_draw(
  p_draw_id uuid, p_evidence_url text default null, p_note text default null, p_share boolean default false)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_row  public.draws;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if p_share and (v_anon or p_evidence_url is null
                  or not exists (select 1 from public.profiles where id = v_uid and username is not null)) then
    raise exception 'necesitas_cuenta_y_prueba' using errcode = '22023';
  end if;
  update public.draws
     set status = 'completed', completed_at = now(), xp = points,
         evidence_url = nullif(btrim(p_evidence_url), ''), note = nullif(btrim(p_note), ''),
         share_in_crew = coalesce(p_share, false)
   where id = p_draw_id and user_id = v_uid and status in ('revealed','started','pending')
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

-- Abandono justificado. «Peligroso» siempre se acepta (y alimenta la revisión
-- del catálogo); los otros motivos, uno por semana.
create or replace function public.abandon_draw(p_draw_id uuid, p_reason text)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.draws;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if p_reason not in ('peligroso','imposible','limite_personal') then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;
  if p_reason <> 'peligroso' and exists (
       select 1 from public.draws
        where user_id = v_uid and status = 'abandoned'
          and abandon_reason in ('imposible','limite_personal')
          and abandoned_at > now() - interval '7 days') then
    raise exception 'limite_abandonos' using errcode = '22023';
  end if;
  update public.draws set status = 'abandoned', abandoned_at = now(), abandon_reason = p_reason, xp = 0
   where id = p_draw_id and user_id = v_uid and status in ('revealed','started','pending')
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

-- Modo pruebas: solo administradores pueden saltar su reto.
create or replace function public.admin_skip_draw(p_draw_id uuid)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.draws;
begin
  if not public.is_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  update public.draws set status = 'abandoned', abandoned_at = now(), abandon_reason = 'prueba_admin', xp = 0
   where id = p_draw_id and user_id = auth.uid() and status in ('revealed','started','pending')
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

-- Confirmación de mayoría de edad (18+), una sola vez.
create or replace function public.confirm_adult()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set adult_confirmed_at = coalesce(adult_confirmed_at, now())
   where id = auth.uid();
$$;

-- Sube una sola vez el progreso que ya estaba en el móvil.
create or replace function public.import_legacy_progress(p_xp integer, p_completed integer, p_stats jsonb)
returns public.legacy_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.legacy_imports;
  v_stats jsonb;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  v_stats := jsonb_build_object(
    'espontanea',   least(greatest(coalesce((p_stats->>'espontanea')::int, 0), 0), 2000),
    'experiencia',  least(greatest(coalesce((p_stats->>'experiencia')::int, 0), 0), 2000),
    'reflexion',    least(greatest(coalesce((p_stats->>'reflexion')::int, 0), 0), 2000),
    'conocimiento', least(greatest(coalesce((p_stats->>'conocimiento')::int, 0), 0), 2000));
  insert into public.legacy_imports (user_id, xp, completed, stats)
  values (v_uid, least(greatest(coalesce(p_xp,0),0),50000), least(greatest(coalesce(p_completed,0),0),2000), v_stats)
  on conflict (user_id) do nothing
  returning * into v_row;
  if not found then raise exception 'ya_importado' using errcode = '23505'; end if;
  return v_row;
end;
$$;

-- Estadísticas calculadas en el servidor (nunca las que manda el móvil).
create or replace function public.my_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select * from public.draws where user_id = auth.uid() and status = 'completed'
  ), weeks as (
    select distinct date_trunc('week', completed_at at time zone 'Europe/Madrid')::date as wk from mine
  ), runs as (
    select wk, wk - (row_number() over (order by wk) * 7)::int as grp from weeks
  ), last_run as (
    select count(*) as len, max(wk) as last_wk from runs group by grp order by max(wk) desc limit 1
  ), legacy as (
    select * from public.legacy_imports where user_id = auth.uid()
  )
  select jsonb_build_object(
    'xp',        coalesce((select sum(xp) from mine), 0) + coalesce((select xp from legacy), 0),
    'completed', (select count(*) from mine) + coalesce((select completed from legacy), 0),
    'by_category', jsonb_build_object(
       'espontanea',   (select count(*) from mine where category = 'espontanea')   + coalesce((select (stats->>'espontanea')::int from legacy), 0),
       'experiencia',  (select count(*) from mine where category = 'experiencia')  + coalesce((select (stats->>'experiencia')::int from legacy), 0),
       'reflexion',    (select count(*) from mine where category = 'reflexion')    + coalesce((select (stats->>'reflexion')::int from legacy), 0),
       'conocimiento', (select count(*) from mine where category = 'conocimiento') + coalesce((select (stats->>'conocimiento')::int from legacy), 0)),
    -- Racha semanal: semanas seguidas con al menos un reto, contando hasta esta o la anterior.
    'week_streak', coalesce((
       select case when last_wk >= (date_trunc('week', now() at time zone 'Europe/Madrid')::date - 7) then len else 0 end
         from last_run), 0)
  );
$$;

-- Tripulación del Barco: solo quien lo cumplió, tiene usuario y decidió compartirlo.
create or replace function public.weekly_crew(p_weekly_id uuid)
returns table (username text, display_name text, avatar_url text, evidence_url text, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username::text, p.display_name, p.avatar_url, d.evidence_url, d.completed_at
    from public.draws d
    join public.profiles p on p.id = d.user_id
   where d.weekly_id = p_weekly_id
     and d.status = 'completed'
     and d.share_in_crew
     and p.username is not null
   order by d.completed_at asc
   limit 500;
$$;

-- ---------- Permisos de las funciones ----------
revoke execute on function
  public.draw_challenge(text), public.join_weekly(uuid), public.start_draw(uuid), public.save_pending(uuid),
  public.complete_draw(uuid, text, text, boolean), public.abandon_draw(uuid, text), public.admin_skip_draw(uuid),
  public.confirm_adult(), public.import_legacy_progress(integer, integer, jsonb), public.my_stats(),
  public.weekly_crew(uuid)
  from public, anon;
grant execute on function
  public.draw_challenge(text), public.join_weekly(uuid), public.start_draw(uuid), public.save_pending(uuid),
  public.complete_draw(uuid, text, text, boolean), public.abandon_draw(uuid, text), public.admin_skip_draw(uuid),
  public.confirm_adult(), public.import_legacy_progress(integer, integer, jsonb), public.my_stats()
  to authenticated;
-- La tripulación es pública (es el escaparate del Barco).
grant execute on function public.weekly_crew(uuid) to anon, authenticated;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- Perfiles de las cuentas que ya existían antes del trigger.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- Aviso del linter: es una función de event trigger (no se puede llamar por la API), pero se cierra igual.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
