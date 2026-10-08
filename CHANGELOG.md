# Cambios

## v2.1.0

- **Catálogo de retos en Supabase.** Los retos ya no van escritos en el código: se cargan desde la base de datos al abrir la app y se guarda una copia para usarla sin conexión. Si el servidor no responde, la app usa la última copia o los 103 retos de serie.
- **Panel de administración dentro de la app** (Ajustes → Administración): entrar con un código por email, publicar retos nuevos, editarlos y desactivarlos. Cada categoría conserva su mecánica (Experiencia a pendientes, Conocimiento en dos fases).
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
- Código separado en lógica (`js/inergo-core.js`) e interfaz (`js/inergo-app.js`). 27 tests de la lógica crítica.
- Service worker nuevo: red primero para el HTML, caché versionada para el resto.
- Cabeceras de seguridad y CSP estricta en `vercel.json`.
- Validación de todos los datos guardados o importados.

### Accesibilidad
- Se puede hacer zoom (antes estaba bloqueado).
- Áreas táctiles de ~40 px en los iconos superiores.
- Lectores de pantalla: anuncio del reto revelado, estados de los botones, foco al cambiar de pantalla, diálogos accesibles, `Escape` para cerrar.
- «Eliminar» en retos predeterminados pasa a «Desactivar» (no se borran, solo salen del sorteo).
- Con «reducir movimiento» activado, el reto se revela sin el carrete largo.
