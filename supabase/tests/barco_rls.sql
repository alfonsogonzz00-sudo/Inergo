-- INERGO · pruebas del Barco de la semana (v2.3). Termina en ROLLBACK: no deja datos.
-- Última ejecución: 21 oct 2026 — 13/13 ok.
begin;
create temp table t_out(n serial, check_name text, ok boolean, detail text) on commit drop;
grant all on t_out to authenticated, anon; grant usage on sequence t_out_n_seq to authenticated, anon;
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-a@inergo.test', now(), '{}','{}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-b@inergo.test', now(), '{}','{}', now(), now());
insert into public.weekly_challenges (id, challenge_id, title, starts_at, ends_at)
values ('00000000-0000-0000-0000-00000000ba01','reflexion-001','Barco de prueba', now() - interval '1 hour', now() + interval '6 days');

set local role anon; select set_config('request.jwt.claims','{"role":"anon"}', true);
insert into t_out(check_name, ok, detail) values ('visitante ve el Barco activo', (select count(*)=1 from public.current_weekly() where id='00000000-0000-0000-0000-00000000ba01'), (select title from public.current_weekly()));
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
do $$ declare d public.draws; begin
  d := public.join_weekly('00000000-0000-0000-0000-00000000ba01');
  insert into t_out(check_name, ok, detail) values ('subirse al Barco fija su reto', d.challenge_id='reflexion-001' and d.weekly_id is not null, d.challenge_id);
  begin perform public.join_weekly('00000000-0000-0000-0000-00000000ba01'); insert into t_out(check_name, ok) values ('no se sube dos veces con reto abierto', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('no se sube dos veces con reto abierto', sqlerrm in ('reto_abierto','ya_en_el_barco'), sqlerrm); end;
  d := public.complete_draw(d.id, null, null, false);
  begin perform public.join_weekly('00000000-0000-0000-0000-00000000ba01'); insert into t_out(check_name, ok) values ('tras cumplirlo no se repite el Barco', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('tras cumplirlo no se repite el Barco', sqlerrm='ya_en_el_barco', sqlerrm); end;
  begin perform public.add_evidence(d.id, 'https://www.tiktok.com/@a/video/1', true); insert into t_out(check_name, ok) values ('compartir exige usuario', false);
  exception when others then insert into t_out(check_name, ok, detail) values ('compartir exige usuario', sqlerrm='necesitas_cuenta_y_prueba', sqlerrm); end;
  update public.profiles set username='prueba_a' where id = auth.uid();
  begin perform public.add_evidence(d.id, 'https://evil.com/x', true); insert into t_out(check_name, ok) values ('enlace no permitido rechazado', false);
  exception when check_violation then insert into t_out(check_name, ok) values ('enlace no permitido rechazado', true); end;
  d := public.add_evidence(d.id, 'https://www.tiktok.com/@a/video/1', true);
  insert into t_out(check_name, ok) values ('vídeo añadido después de completar', d.evidence_url is not null and d.share_in_crew);
end $$;
reset role;

set local role anon; select set_config('request.jwt.claims','{"role":"anon"}', true);
insert into t_out(check_name, ok) values ('tripulación pública muestra a A', (select count(*)=1 from public.weekly_crew('00000000-0000-0000-0000-00000000ba01') where username='prueba_a'));
insert into t_out(check_name, ok) values ('contador del Barco = 1', (select crew=1 from public.current_weekly()));
do $$ begin
  begin perform public.add_evidence(gen_random_uuid(), 'https://youtu.be/x', false); insert into t_out(check_name, ok) values ('visitante no añade pruebas', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('visitante no añade pruebas', true); end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
do $$ declare aid uuid; begin
  select d.id into aid from public.draws d limit 1;
  insert into t_out(check_name, ok) values ('B no ve el reto de A', aid is null);
  begin insert into public.weekly_challenges (challenge_id, title, starts_at, ends_at) values ('reflexion-002','hack', now(), now()+interval '1 day');
        insert into t_out(check_name, ok) values ('no-admin no crea Barcos', false);
  exception when insufficient_privilege then insert into t_out(check_name, ok) values ('no-admin no crea Barcos', true); end;
end $$;
reset role;
insert into t_out(check_name, ok) values ('B no cambió la prueba de A', (select evidence_url = 'https://www.tiktok.com/@a/video/1' from public.draws where user_id='00000000-0000-0000-0000-0000000000a1'));

select n, check_name, ok, left(detail,80) as detail from t_out order by n;
rollback;
