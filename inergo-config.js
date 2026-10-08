/* =========================================================
   INERGO — configuración pública
   ---------------------------------------------------------
   Estos dos valores son PÚBLICOS por diseño (van en cualquier app web
   que use Supabase). La seguridad la dan las reglas de la base de datos
   (Row Level Security), no ocultar esta clave.

   NUNCA pongas aquí la clave "secret" ni la "service_role".
   Si cambias de proyecto de Supabase, actualiza también connect-src
   en la Content-Security-Policy de vercel.json.
========================================================= */
window.INERGO_CONFIG = Object.freeze({
  supabaseUrl: "https://wobatwkkvmuxnfhhgzzu.supabase.co",
  supabaseKey: "sb_publishable_ziAhPDGAnI7J2c0OWBFaCA_Ce-nKSvJ"
});
