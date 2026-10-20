-- INERGO · pruebas de reglas y permisos del MVP.
-- Todo ocurre en una transacción que termina en ROLLBACK: no deja datos.
begin;
create temp table t_out(n serial, check_name text, ok boolean, detail text) on commit drop;
grant all on t_out to authenticated, anon; grant usage on sequence t_out_n_seq to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-a@inergo.test', now(), '{}','{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-b@inergo.test', now(), '{}','{}', now(), now());
insert into t_out(check_name, ok) values ('trigger crea perfiles', (select count(*)=2 from public.profiles where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2')));

-- ===== Usuario A =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);

do $$
declare d1 public.draws; d2 public.draws; d3 public.draws; s jsonb;
begin
  d1 := public.draw_challenge('espontanea');
  insert into t_out(check_name, ok, detail) values ('sorteo devuelve espontánea', d1.category='espontanea' and d1.status='revealed', d1.challenge_id);
  d2 := public.draw_challenge('reflexion');
  insert into t_out(check_name, ok, detail) values ('segundo giro devuelve el MISMO reto (regla central)', d2.id = d1.id, d2.challenge_id);

  begin insert into public.draws(user_id, challenge_id, challenge_text, category, points) values (auth.uid(), 'reflexion-001','x','reflexion',15);
        insert into t_out(check_name, ok) values ('insert directo bloqueado', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('insert directo bloqueado', true); end;
  begin update public.draws set status='completed', xp=500 where id = d1.id;
        insert into t_out(check_name, ok) values ('update directo bloqueado', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('update directo bloqueado', true); end;
  begin delete from public.draws where id = d1.id;
        insert into t_out(check_name, ok) values ('delete directo bloqueado', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('delete directo bloqueado', true); end;

  d1 := public.start_draw(d1.id);
  begin perform public.complete_draw(d1.id, 'https://evil.com/x', null, false);
        insert into t_out(check_name, ok) values ('rechaza prueba fuera de TikTok/IG/YouTube', false);
  exception when check_violation then insert into t_out(check_name, ok) values ('rechaza prueba fuera de TikTok/IG/YouTube', true); end;
  begin perform public.complete_draw(d1.id, 'https://www.tiktok.com/@a/video/1', null, true);
        insert into t_out(check_name, ok) values ('compartir en tripulación exige usuario', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('compartir en tripulación exige usuario', sqlerrm='necesitas_cuenta_y_prueba', sqlerrm); end;

  d1 := public.complete_draw(d1.id, 'https://www.tiktok.com/@a/video/1', 'hecho', false);
  insert into t_out(check_name, ok, detail) values ('completar da los XP del catálogo', d1.status='completed' and d1.xp = d1.points, d1.xp::text);

  d3 := public.draw_challenge('todos');
  insert into t_out(check_name, ok) values ('tras completar, se puede girar otra vez', d3.id <> d1.id);
  d3 := public.abandon_draw(d3.id, 'imposible');
  insert into t_out(check_name, ok) values ('abandono justificado, 0 XP', d3.status='abandoned' and d3.xp=0);
  d3 := public.draw_challenge('todos');
  begin perform public.abandon_draw(d3.id, 'limite_personal');
        insert into t_out(check_name, ok) values ('2º abandono de la semana bloqueado', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('2º abandono de la semana bloqueado', sqlerrm='limite_abandonos', sqlerrm); end;
  d3 := public.abandon_draw(d3.id, 'peligroso');
  insert into t_out(check_name, ok) values ('«peligroso» siempre permitido', d3.status='abandoned');

  d3 := public.draw_challenge('todos');
  begin perform public.admin_skip_draw(d3.id);
        insert into t_out(check_name, ok) values ('saltar (modo pruebas) solo admin', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('saltar (modo pruebas) solo admin', sqlerrm='solo_admin', sqlerrm); end;
  perform public.abandon_draw(d3.id, 'peligroso');

  d3 := public.draw_challenge('experiencia');
  d3 := public.save_pending(d3.id);
  d2 := public.draw_challenge('experiencia');
  insert into t_out(check_name, ok) values ('experiencia apuntada libera hueco y no se repite', d3.status='pending' and d2.challenge_id <> d3.challenge_id);

  s := public.my_stats();
  insert into t_out(check_name, ok, detail) values ('estadísticas del servidor', (s->>'completed')::int = 1 and (s->>'week_streak')::int = 1, s::text);
  perform public.import_legacy_progress(300, 12, '{"espontanea":5,"reflexion":7}');
  begin perform public.import_legacy_progress(9999, 1, '{}');
        insert into t_out(check_name, ok) values ('importación del móvil solo una vez', false);
  exception when others then insert into t_out(check_name, ok) values ('importación del móvil solo una vez', sqlerrm='ya_importado'); end;
  s := public.my_stats();
  insert into t_out(check_name, ok, detail) values ('estadísticas suman lo importado', (s->>'completed')::int = 13 and (s->>'xp')::int = 300 + d1.xp, s::text);

  begin update public.profiles set adult_confirmed_at = now() where id = auth.uid();
        insert into t_out(check_name, ok) values ('no puede falsear la edad por update', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('no puede falsear la edad por update', true); end;
  perform public.confirm_adult();
  insert into t_out(check_name, ok) values ('confirm_adult funciona', (select adult_confirmed_at is not null from public.profiles where id = auth.uid()));
  update public.profiles set username='prueba_a', is_public=true where id = auth.uid();
  begin update public.profiles set username='NO VALIDO!' where id = auth.uid();
        insert into t_out(check_name, ok) values ('usuario con formato inválido rechazado', false);
  exception when check_violation then insert into t_out(check_name, ok) values ('usuario con formato inválido rechazado', true); end;
end $$;
reset role;

-- ===== Usuario B =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_out(check_name, ok) values ('B no ve los retos de A', (select count(*)=0 from public.draws));
insert into t_out(check_name, ok) values ('B ve el perfil público de A', (select count(*)=1 from public.profiles where username='prueba_a'));
do $$ declare n int; begin
  update public.profiles set bio='hack' where id='00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  insert into t_out(check_name, ok) values ('B no edita el perfil de A', n=0);
end $$;
reset role;
do $$ declare aid uuid; begin
  select id into aid from public.draws where user_id='00000000-0000-0000-0000-0000000000a1' and status='completed' limit 1;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.abandon_draw(aid, 'peligroso'); exception when others then null; end;
  reset role;
end $$;
insert into t_out(check_name, ok) values ('B no pudo tocar el reto completado de A', (select count(*)=1 from public.draws where user_id='00000000-0000-0000-0000-0000000000a1' and status='completed'));

-- ===== Visitante sin sesión =====
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}', true);
do $$ begin
  begin perform public.draw_challenge('todos'); insert into t_out(check_name, ok) values ('sin sesión no puede girar', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('sin sesión no puede girar', true); end;
end $$;
insert into t_out(check_name, ok) values ('visitante lee retos activos', (select count(*)>100 from public.challenges));
insert into t_out(check_name, ok) values ('visitante no ve retos asignados', (select count(*)=0 from public.draws));
reset role;

select n, check_name, ok, left(detail,120) as detail from t_out order by n;
rollback;
