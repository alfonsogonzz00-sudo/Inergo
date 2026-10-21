-- =========================================================
-- INERGO · Barco de la semana: prueba en vídeo después de completar
-- ---------------------------------------------------------
-- · add_evidence: añade (o cambia) el enlace del vídeo de un reto ya
--   completado, durante 30 días, y decide si sale en la tripulación.
-- · current_weekly: el Barco activo con su número de tripulantes.
-- =========================================================

create or replace function public.add_evidence(p_draw_id uuid, p_evidence_url text, p_share boolean default false)
returns public.draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_url  text := nullif(btrim(p_evidence_url), '');
  v_row  public.draws;
begin
  if v_uid is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if v_url is null then raise exception 'falta_enlace' using errcode = '22023'; end if;
  if p_share and (v_anon or not exists (select 1 from public.profiles where id = v_uid and username is not null)) then
    raise exception 'necesitas_cuenta_y_prueba' using errcode = '22023';
  end if;
  update public.draws
     set evidence_url = v_url, share_in_crew = coalesce(p_share, false)
   where id = p_draw_id and user_id = v_uid and status = 'completed'
     and completed_at > now() - interval '30 days'
  returning * into v_row;
  if not found then raise exception 'reto_no_disponible' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

-- El Barco activo ahora mismo (o ninguno), con cuántos lo han cumplido y compartido.
create or replace function public.current_weekly()
returns table (id uuid, title text, challenge_id text, challenge_text text, category text,
               starts_at timestamptz, ends_at timestamptz, crew integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.title, w.challenge_id, c.text, c.category, w.starts_at, w.ends_at,
         (select count(*)::int from public.draws d
           where d.weekly_id = w.id and d.status = 'completed' and d.share_in_crew)
    from public.weekly_challenges w
    join public.challenges c on c.id = w.challenge_id
   where now() between w.starts_at and w.ends_at
   order by w.starts_at desc
   limit 1;
$$;

revoke execute on function public.add_evidence(uuid, text, boolean), public.current_weekly() from public, anon;
grant execute on function public.add_evidence(uuid, text, boolean) to authenticated;
grant execute on function public.current_weekly() to anon, authenticated;
