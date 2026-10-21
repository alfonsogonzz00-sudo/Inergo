# Cambios

## v2.3.0 (rama `barco-de-la-semana`)

- **Barco de la semana.** Un reto fijo para toda la comunidad durante unos días. Etiqueta «Barco · N a bordo» en la home → pantalla con el reto, la fecha de cierre y la tripulación. «Subirme al Barco» lo convierte en tu reto (con la ruleta, sin vuelta atrás).
- **Añadir mi vídeo** tras completar un reto: enlace de TikTok, Instagram o YouTube (se valida en el móvil y en la base de datos) y, si es del Barco, opción de salir en la tripulación con tu usuario.
- **Tarjeta para historias** (1080×1920): «Me ha tocado», «Lo he hecho» o «Barco de la semana». Abre el menú de compartir del móvil o descarga la imagen.
- **Usuario** en Ajustes → Tu cuenta.
- **Administración → Barco de la semana:** elegir reto, título y duración, y lanzarlo.
- Base de datos: `add_evidence` y `current_weekly` (13 pruebas en `supabase/tests/barco_rls.sql`).

## v2.2.0 (rama `mvp-cuentas-y-sorteo-servidor`, sin publicar)

- **Sorteo en el servidor.** Con conexión, PLAY crea una sesión anónima (sin registro) y pide el reto a `draw_challenge`: si ya tienes uno abierto, en este u otro dispositivo, te devuelve ese. La ruleta arranca al instante y el reto real se coloca en la última casilla al llegar. Sin conexión o si el servidor no contesta en 6 s, se sortea en el móvil como antes.
- **Cada paso se apunta en el servidor** (empezar, apuntar en pendientes, completar, saltar en modo pruebas) con una cola de reintentos si falla la red (`inergo_outbox_v1`).
- **Abandono justificado:** «No puedo hacerlo» bajo cada reto, con tres motivos. No suma XP. «Es peligroso» siempre se acepta; los otros, uno por semana (lo decide la base de datos).
- **Tu cuenta** en Ajustes: email + contraseña y confirmación de 18+. La cuenta anónima se convierte en la cuenta nueva y el progreso del móvil se sube una vez (`import_legacy_progress`).
- La entrada de Administración ya no aparece por tener sesión: solo tras el gesto secreto o si la base de datos te reconoce como admin.
- Campos de contraseña con el mismo estilo que el resto (CSS recompilado).

## v2.1.6

- **Revisión de seguridad del catálogo** (aprobada el 20 oct 2026): sin autostop (`experiencia-003`), sin grabar a desconocidos sin permiso (`espontanea-001`), confesión más ligera (`espontanea-005`), abrazo con «si dice que no, lo aceptas» (`espontanea-003`, riesgo medio) y `espontanea-013` retirado (lo cubre Conocimiento). Copia de serie: 102 retos.
- **Línea de seguridad** bajo cada reto revelado: «Si grabas a alguien, pide permiso. Si algo te pone en riesgo, no lo hagas.»
- Los mismos cambios para el catálogo de Supabase están al final de `supabase/seed.sql`.

## v2.1.5

- **Modo pruebas solo para administradores.** `?test=1` y los 5 toques en la versión ya no activan el modo pruebas: solo muestran la entrada de Administración. El interruptor aparece cuando la base de datos confirma que la sesión es de un administrador. Quien tuviera el modo pruebas guardado de antes lo pierde sin hacer nada.
- **Analítica de visitas** con Vercel Web Analytics (sin cookies). El service worker no la cachea.
- **Base de datos del MVP (aplicada en Supabase, la app aún no la usa):** `profiles`, `draws`, `weekly_challenges`, `reports`, `legacy_imports` y `challenges.risk_level`. El sorteo, empezar, apuntar, completar y abandonar solo se hacen con funciones de la base de datos; un índice único garantiza un solo reto abierto por persona. 28 pruebas de permisos y reglas superadas (`supabase/tests/mvp_rls.sql`).

## v2.1.4

- **Nuevo reto de Experiencia:** «Practica un deporte que no suelas hacer en un lugar/zona que no sea habitual para ti y haz un vlog.» (`experiencia-011`, en el catálogo de Supabase).
- **Modo pruebas con reto fijo:** con el modo pruebas activado, PLAY en Experiencia da siempre ese reto (aunque esté en pendientes o haya salido hace poco). El resto de categorías, TODOS y el modo normal sortean como siempre. Se configura en `TEST_PINNED` (`inergo-core.js`).
- Un mismo reto nunca aparece dos veces en Pendientes.

## v2.1.3

- **Ruleta de ~3 segundos** desde que pulsas PLAY hasta que aparece el reto.
- **Acceso al catálogo con enlace por email**, sin código: funciona con las plantillas de serie de Supabase (el plan gratuito no permite editarlas). La pestaña donde lo pediste entra sola cuando abres el enlace en otra; si el enlace ha caducado, la app lo dice y deja pedir otro.

## v2.1.2

- **La ruleta vuelve a verse siempre.** Con «Reducir movimiento» activado en el sistema (Mac, Windows, iPhone) la v2 se la saltaba; la versión original la mostraba. Es parte del producto, así que se muestra siempre.
- **La ruleta dura más:** unos 4 segundos desde que pulsas PLAY hasta que aparece el reto (antes ~3).

## v2.1.1

- **Todos los archivos de la app en la raíz, sin carpetas.** GitHub aplana los archivos al arrastrarlos y la v2.1.0 buscaba `js/` y `fonts/`: la app no arrancaba.
- **El service worker ya no se bloquea** si falta algún archivo al actualizar: antes, un solo archivo ausente dejaba al usuario atrapado en la versión anterior.

## v2.1.0

- **Catálogo de retos en Supabase.** Los retos ya no van escritos en el código: se cargan desde la base de datos al abrir la app y se guarda una copia para usarla sin conexión. Si el servidor no responde, la app usa la última copia o los 103 retos de serie.
- **Panel de administración dentro de la app** (Ajustes → Administración): entrar por email, publicar retos nuevos, editarlos y desactivarlos. Cada categoría conserva su mecánica (Experiencia a pendientes, Conocimiento en dos fases).
- **Seguridad:** solo los emails autorizados y confirmados pueden modificar el catálogo; lo impone la base de datos (RLS), no la app.
- Los retos desactivados en «Mis retos» funcionan también con los retos nuevos del catálogo.

## v2.0.1

- **Modo pruebas:** permite saltar un reto revelado para poder testear la app sin quedarte atado a cada reto. Se activa con `?test=1` o tocando 5 veces la versión en Ajustes; muestra la etiqueta «MODO PRUEBAS» en la home. Desactivado por defecto para todo el mundo.

## v2.0.0

### Regla central reforzada
- El reto queda guardado desde que pulsas PLAY. Volver a la home, recargar o cerrar la app ya no permite tirar otra vez: al volver, INERGO te devuelve al mismo reto (el botón PLAY pasa a «TU RETO»).
- «Sorpréndeme» (pulsar 2 s el logo) también respeta un reto en marcha.

### Errores corregidos
- El temporizador se congelaba al bloquear el móvil. Ahora cuenta con la hora real: al volver marca lo que de verdad queda.
- El contador «Retos» de Progreso se quedaba en 40.
- La racha usaba la hora UTC: un reto entre las 00:00 y las 02:00 contaba para el día anterior. Ahora usa la hora local (y aguanta el cambio de hora).
- La racha mostraba días seguidos aunque ya se hubiera roto.
- Salir durante el sorteo dejaba la animación corriendo en segundo plano.
- Sin conexión, la app se abría sin estilos (Tailwind y las fuentes venían de fuera).
- Quien tenía la app instalada podía quedarse en versiones antiguas.
- En pantallas muy bajas (320×568) el reloj tapaba el texto del reto.

### Nuevo
- **Ajustes:** sonido, vibración, instalar la app (Android/escritorio con un toque; en iPhone, instrucciones), ver la introducción, exportar/importar copia, borrar todo, versión.
- **Introducción** de 3 pasos solo para usuarios nuevos (se puede saltar; quien ya usaba la app no la ve).
- **Pantalla siempre encendida** mientras haces un reto (donde el navegador lo permite).
- **Sonido de cuenta atrás** en los últimos 5 segundos y aviso al acabar el tiempo.
- **Aviso de nueva versión** (nunca en mitad de un reto).
- **Accesos directos** al mantener pulsado el icono (Android): Pendientes y Progreso.
- **Imagen al compartir** el enlace.

### Técnica
- CSS compilado y fuentes autoalojadas: sin dependencias externas, carga más rápida, funciona sin conexión.
- Código separado en lógica (`inergo-core.js`) e interfaz (`inergo-app.js`). 27 tests de la lógica crítica.
- Service worker nuevo: red primero para el HTML, caché versionada para el resto.
- Cabeceras de seguridad y CSP estricta en `vercel.json`.
- Validación de todos los datos guardados o importados.

### Accesibilidad
- Se puede hacer zoom (antes estaba bloqueado).
- Áreas táctiles de ~40 px en los iconos superiores.
- Lectores de pantalla: anuncio del reto revelado, estados de los botones, foco al cambiar de pantalla, diálogos accesibles, `Escape` para cerrar.
- «Eliminar» en retos predeterminados pasa a «Desactivar» (no se borran, solo salen del sorteo).
