-- Borra los 4 usuarios creados por las pruebas del 20 oct 2026 (sus retos y perfiles se van en cascada).
-- Ejecutar a mano en Supabase → SQL Editor.
delete from auth.users where id in (
  '6c8eaa9c-fe0b-4582-a053-ea4184db0b3f',
  'd0fcb0f5-64db-4dba-8c5f-134df9ff48f4',
  '9c436ec8-c2eb-4089-83b3-5fc85f36de80',
  'fed1b4ee-c0ec-48bb-8e49-aa7f848dc2ce'
);
