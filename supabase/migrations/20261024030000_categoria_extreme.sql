-- =========================================================
-- INERGO · Categoría EXTREME (v2.4.0)
-- ---------------------------------------------------------
-- Retos que se hacen hoy, en cualquier ciudad del mundo y casi
-- siempre con desconocidos. Mecánica de cronómetro, +40 XP.
-- · Admite 'extreme' en challenges y draws.
-- · draw_challenge, my_stats e import_legacy_progress la conocen
--   (se parchea la definición viva para no pisar otros cambios).
-- · Inserta los 15 retos de serie.
-- =========================================================

alter table public.challenges drop constraint challenges_category;
alter table public.challenges add constraint challenges_category
  check (category in ('espontanea','experiencia','reflexion','conocimiento','extreme'));

alter table public.challenges drop constraint challenges_type_matches_category;
alter table public.challenges add constraint challenges_type_matches_category check (
  (category = 'experiencia'  and duration_type = 'pending')  or
  (category = 'conocimiento' and duration_type = 'research') or
  (category in ('espontanea','reflexion','extreme') and duration_type = 'timer')
);

alter table public.draws drop constraint draws_category;
alter table public.draws add constraint draws_category
  check (category in ('espontanea','experiencia','reflexion','conocimiento','extreme'));

do $patch$
declare v_def text; v_new text;
begin
  -- draw_challenge: aceptar 'extreme' como categoría pedida.
  v_def := pg_get_functiondef('public.draw_challenge(text)'::regprocedure);
  v_new := replace(v_def, $s$'reflexion','conocimiento')$s$, $s$'reflexion','conocimiento','extreme')$s$);
  if v_new = v_def then raise exception 'draw_challenge: patrón no encontrado'; end if;
  execute v_new;

  -- my_stats: contar los EXTREME completados.
  v_def := pg_get_functiondef('public.my_stats()'::regprocedure);
  v_new := replace(v_def,
    $s$coalesce((select (stats->>'conocimiento')::int from legacy), 0))$s$,
    $s$coalesce((select (stats->>'conocimiento')::int from legacy), 0),
       'extreme',      (select count(*) from mine where category = 'extreme')      + coalesce((select (stats->>'extreme')::int from legacy), 0))$s$);
  if v_new = v_def then raise exception 'my_stats: patrón no encontrado'; end if;
  execute v_new;

  -- import_legacy_progress: conservar el contador EXTREME del móvil.
  v_def := pg_get_functiondef('public.import_legacy_progress(integer, integer, jsonb)'::regprocedure);
  v_new := replace(v_def,
    $s$least(greatest(coalesce((p_stats->>'conocimiento')::int, 0), 0), 2000))$s$,
    $s$least(greatest(coalesce((p_stats->>'conocimiento')::int, 0), 0), 2000),
    'extreme',      least(greatest(coalesce((p_stats->>'extreme')::int, 0), 0), 2000))$s$);
  if v_new = v_def then raise exception 'import_legacy_progress: patrón no encontrado'; end if;
  execute v_new;
end
$patch$;

insert into public.challenges (id, text, category, duration_type, duration_seconds, research_seconds, talk_seconds, points, active, sort_order) values
  ('extreme-001', 'Pregunta a un desconocido qué vas a comer ahora. Lo que te diga es lo que comes, sin negociar.', 'extreme', 'timer', 1800, null, null, 40, true, 1110),
  ('extreme-002', 'Marca este reto como hecho y dale tu móvil a un desconocido: que sea él quien pulse PLAY. El reto que le salga es tuyo, sin cambiarlo.', 'extreme', 'timer', 600, null, null, 40, true, 1120),
  ('extreme-003', 'Entra en una tienda y regatea el precio de un producto hasta que te lo rebajen. Si no lo consigues, no lo compras.', 'extreme', 'timer', 900, null, null, 40, true, 1130),
  ('extreme-004', 'Guarda el móvil y llega a un sitio que no conozcas preguntando solo a la gente. Sin mapas.', 'extreme', 'timer', 1800, null, null, 40, true, 1140),
  ('extreme-005', 'Pregunta a un desconocido cuál es el mejor sitio de la zona que no sale en las guías, y ve ahora mismo.', 'extreme', 'timer', 1800, null, null, 40, true, 1150),
  ('extreme-006', 'Durante 15 minutos, en cada cruce, pregunta a alguien nuevo hacia dónde caminas. Haz lo que te diga.', 'extreme', 'timer', 900, null, null, 40, true, 1160),
  ('extreme-007', 'Pide a un desconocido que te enseñe a decir una frase en su idioma o con su acento, y úsala con las tres siguientes personas con las que hables.', 'extreme', 'timer', 1200, null, null, 40, true, 1170),
  ('extreme-008', 'Busca a alguien que esté comiendo o tomando algo solo y pregúntale si puedes sentarte con él cinco minutos.', 'extreme', 'timer', 900, null, null, 40, true, 1180),
  ('extreme-009', 'Pide a un desconocido que te enseñe algo que sepa hacer y tú no, y hazlo delante de él.', 'extreme', 'timer', 900, null, null, 40, true, 1190),
  ('extreme-010', 'Entra en un sitio donde no pintas nada (una barbería, un taller, una academia de baile, un gimnasio) y pide probar lo que hacen allí.', 'extreme', 'timer', 1200, null, null, 40, true, 1200),
  ('extreme-011', 'Pide a un músico o artista callejero que te deje participar en su actuación.', 'extreme', 'timer', 900, null, null, 40, true, 1210),
  ('extreme-012', 'Invita a un café a un desconocido y pregúntale qué haría él si fuese tú hoy.', 'extreme', 'timer', 1200, null, null, 40, true, 1220),
  ('extreme-013', 'Haz una pregunta en voz alta a todo un bar o cafetería, y no te vayas hasta que alguien te conteste.', 'extreme', 'timer', 600, null, null, 40, true, 1230),
  ('extreme-014', 'Pide a un desconocido que te lleve al sitio más bonito que conozca cerca de aquí y que te haga una foto allí.', 'extreme', 'timer', 1800, null, null, 40, true, 1240),
  ('extreme-015', 'Pide a un desconocido que te grabe mientras cuentas a cámara por qué estás aquí hoy y qué te da miedo.', 'extreme', 'timer', 600, null, null, 40, true, 1250)
on conflict (id) do nothing;
