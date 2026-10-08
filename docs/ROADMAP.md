# INERGO — Hoja de ruta técnica

## Hecho en v2.0.0 (P0)

Ver `docs/CHANGELOG.md`.

## Hecho en v2.1.0

- Proyecto Supabase `Inergo` (eu-west-1) con `public.challenges` (catálogo), `private.admin_emails` y `public.is_admin()`. RLS probada.
- La app lee el catálogo con copia offline y tiene panel de administración con login por código.

## P1 — Usuarios reales (cuando la app se abra a la comunidad)

Lo que falta para cuentas de usuario.

### Backend elegido: Supabase

| Opción | Por qué sí / por qué no |
|---|---|
| **Supabase** | Postgres + seguridad por filas (RLS) + auth (magic link, Google, Apple) + funciones y cron para push. Un solo proveedor, plan gratuito. Ojo: el proyecto gratuito se pausa tras 7 días sin actividad. |
| Firebase | NoSQL: encaja peor con estadísticas y catálogo; más dependencia de Google. |
| Clerk + BD | Dos proveedores y más coste para una sola persona. |
| Backend propio | Demasiado mantenimiento para esta fase. |

### Modelo: local primero

- **Sin cuenta:** todo igual que hoy (`localStorage`).
- **Al crear cuenta:** se sube el progreso local. No se borra del móvil hasta confirmar que el servidor lo tiene.
- **Con cuenta:** la app sigue leyendo y escribiendo en local (rápida y offline) y sincroniza en segundo plano.
- **Conflictos:** XP, estadísticas e historial se fusionan por suma de eventos (cada reto completado es un evento con id único, así que no hay dobles). Ajustes y retos desactivados: gana el cambio más reciente. Reto activo: gana el que se reveló antes (nadie esquiva un reto desde otro móvil).
- **Si falla la red:** el flujo de retos nunca se bloquea; aparece «pendiente de sincronizar».

### Tablas previstas

- `challenges` — catálogo global. **Ya existe** (v2.1.0).
- `profiles` — 1:1 con `auth.users`: ajustes, rol (`user`/`admin`).
- `completions` — un registro por reto completado (`id uuid` generado en el móvil, `user_id`, `challenge_id`, texto, categoría, xp, `completed_at`).
- `custom_challenges`, `pending_challenges`, `disabled_defaults`, `active_challenge` — datos personales.
- `push_subscriptions` — para P2.

RLS en todas: `user_id = auth.uid()` para leer, crear, cambiar y borrar. XP y racha se calculan desde `completions` (no se confía en el valor que manda el cliente).

### Autenticación

- Enlace mágico por email + Google. Apple Sign In cuando haya cuenta de desarrollador de Apple (99 $/año).
- En el cliente solo van `SUPABASE_URL` y la clave **anon** (pública por diseño; la seguridad la da RLS). La clave `service_role` **nunca** en el cliente ni en GitHub.
- Al añadir Supabase: añadir `https://<proyecto>.supabase.co` a `connect-src` en la CSP de `vercel.json`.

### Panel de administración

**Hecho en v2.1.0.** Siguiente mejora posible: estadísticas por reto (cuántas veces sale, se completa o se apunta), cuando haya analítica.

### Antes del lanzamiento público

- SMTP propio (Resend u otro) en Supabase: el de serie solo envía a emails del equipo.
- Plan Pro de Supabase (no se pausa, copias diarias).
- Dominio propio y, si se monetiza, Vercel Pro.

### Privacidad (obligatorio con cuentas)

Política de privacidad, borrar cuenta y datos, exportar datos, edad mínima 14 años (España).

### Analítica

Umami Cloud (gratuito, sin cookies). Eventos: `app_open`, `category_selected`, `play_pressed`, `challenge_revealed`, `challenge_started`, `challenge_completed`, `pending_saved`, `custom_challenge_created`, `install_prompt`, `pwa_installed`, `signup_started`, `signup_completed`. **Nunca** se envía el texto de retos personalizados. Requiere añadir su dominio a la CSP.

## P2 — Preparado para el futuro

### Notificaciones push

- Android y escritorio: funcionan.
- iPhone: solo con la app **instalada** en la pantalla de inicio (iOS 16.4+). En Safari normal no existen.
- Piezas: claves VAPID, tabla `push_subscriptions`, Edge Function de Supabase para enviar, cron para recordatorios (pendientes, racha en peligro).
- Permiso pedido en contexto (por ejemplo al apuntar un reto de Experiencia), nunca al abrir la app.
- Los enlaces directos ya existen: `inergo.html?s=pending`, `?s=progress`, `?s=mychallenges`, `?s=settings`.

## Decisiones de producto abiertas

1. **Chat y feed social:** no implementados. Implican moderación, normativa europea de servicios digitales y protección de menores. Revisar cuando haya comunidad.
2. **Contraste:** el blanco sobre el naranja `#FF6347` da 2,9:1 (WCAG pide 4,5:1 en texto pequeño). No se ha tocado la identidad. Propuesta pendiente: subir la opacidad de los textos pequeños.
3. **Catálogo de retos:** revisión de contenido en curso, aparte del código. El código no ha cambiado ningún reto.
