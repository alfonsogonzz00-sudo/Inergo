# INERGO — Te toca.

App web instalable (PWA) que propone un reto incómodo para que lo hagas y lo grabes. HTML + CSS + JavaScript sin framework. El **catálogo de retos** vive en **Supabase**; el **progreso de cada persona** se guarda en su navegador (`localStorage`).

**Flujo:** abrir INERGO → elegir categoría → PLAY → sorteo → aparece el reto → TE TOCA → EMPEZAR / INVESTIGAR / APUNTAR → LO HE HECHO → se actualiza el progreso.

**Regla central:** una vez pulsado PLAY, el reto no se puede rechazar, cambiar ni saltar. Desde la v2 esto se cumple también si sales a la home, recargas o cierras la app: al volver, INERGO te devuelve al mismo reto.

## Modo pruebas (solo para testear)

Permite **saltar un reto ya revelado** sin completarlo (no suma XP ni racha). Para cualquier otro usuario la regla sigue intacta.

- **Activar:** abre `inergo.vercel.app/?test=1`, o en la app instalada ve a **Ajustes y toca 5 veces el texto de la versión** (abajo del todo).
- **Se nota:** en la home aparece la etiqueta negra «MODO PRUEBAS» y, durante un reto, el enlace «Saltar reto · modo pruebas».
- **Desactivar:** interruptor «Modo pruebas» en Ajustes, `?test=0` o otros 5 toques en la versión. **Desactívalo antes de grabar.**

## Catálogo de retos (Supabase)

Los retos que salen al tirar se gestionan **desde la propia app**, sin tocar código ni GitHub.

- **Entrar:** Ajustes → *Administración → Catálogo de retos → Abrir* (la sección aparece en modo pruebas o con la sesión iniciada). Pon tu email, te llega un código de 6 cifras y entras.
- **Añadir:** escribe el reto, elige categoría (y tiempo si es Espontánea o Reflexión) y *Publicar reto*. Sale al tirar en cuanto se publica.
- **Editar / desactivar:** desde la lista. Desactivar no borra: el reto deja de salir y se puede reactivar.
- **Cada categoría tiene su mecánica:** Espontánea y Reflexión con cronómetro, Experiencia va a Pendientes, Conocimiento investiga 10 min y habla 1 min. La base de datos no permite mezclarlas.
- **Sin conexión:** la app usa la última lista descargada; si nunca ha conectado, los 103 retos de serie (`inergo-core.js`).
- **Quién puede editar:** solo los emails de la tabla privada `private.admin_emails`, y solo con el email confirmado. Para añadir a alguien, en Supabase → SQL Editor:
  `insert into private.admin_emails (email) values ('otra@persona.com');`

### Configuración de Supabase (una sola vez)

1. **Authentication → Email Templates → Magic Link** y **Confirm signup**: añade `{{ .Token }}` al texto del email (por ejemplo `<p>Tu código: <strong>{{ .Token }}</strong></p>`). Sin esto, el email solo trae un enlace y no un código.
2. **Authentication → URL Configuration:** *Site URL* `https://inergo.vercel.app` y en *Redirect URLs* añade `https://inergo.vercel.app/**`. Así también funciona el enlace del email.
3. **Antes de abrir la app al público:** configura un SMTP propio (Authentication → SMTP; por ejemplo Resend). El servicio de email de serie de Supabase solo envía a los emails del equipo del proyecto y con muy pocos envíos por hora.

### Base de datos

- `supabase/migrations/` — tablas, función `is_admin()` y reglas de seguridad (RLS). Ya aplicadas en el proyecto `Inergo` (eu-west-1).
- `supabase/seed.sql` — los 103 retos de serie con los mismos ids que la app. Se puede ejecutar varias veces sin duplicar.
- Configuración pública del cliente en `inergo-config.js` (URL y clave *publishable*, públicas por diseño). **Nunca** pongas ahí la clave *secret* ni la *service_role*.

---

## Estructura

Todos los archivos que usa la app están **en la raíz, sin carpetas**: así da igual cómo se suban a GitHub.

```
inergo.html              ← la app (solo marcado; sin código en línea)
inergo.css               ← estilos COMPILADOS (no editar a mano)
inergo-config.js         ← URL y clave pública de Supabase
inergo-core.js           ← lógica pura: retos de serie, catálogo, sorteo, XP, racha, reto activo, copias
inergo-cloud.js          ← conexión con Supabase: catálogo, inicio de sesión, gestión de retos
inergo-app.js            ← interfaz: pantallas, animaciones, sonido, ajustes, panel de catálogo
inter-latin-var.woff2, manrope-latin-var.woff2   ← fuentes autoalojadas
manifest.json            ← datos de instalación (nombre, iconos, accesos directos)
sw.js                    ← service worker: offline y actualizaciones
vercel.json              ← "/" carga inergo.html + cabeceras de seguridad
og-image.png             ← imagen al compartir el enlace
icon-*.png, apple-touch-icon.png
```

Material de trabajo (no lo usa la app; si se sube aplanado a la raíz no pasa nada):

```
tools/                   ← fuente del CSS y configuración de Tailwind
tests/                   ← tests de la lógica crítica
supabase/                ← migraciones SQL y retos de serie
docs/                    ← CHANGELOG y ROADMAP
```

## Subir a GitHub (sin terminal)

1. Abre el repositorio en GitHub desde **Chrome** → **Add file → Upload files**.
2. Arrastra **todos los archivos** de la carpeta descomprimida. Si GitHub los deja todos en la raíz, es correcto.
3. Mensaje del commit, por ejemplo `INERGO v2.1.1`, y **Commit changes**.
4. Vercel despliega solo en 1-2 minutos.

No hay que tocar la configuración de Vercel (sigue siendo un sitio estático, sin paso de compilación).

**Quien ya tenga la app** verá la versión nueva al volver a abrirla (como mucho, a la segunda). Su progreso se conserva.

## Publicar una versión nueva (para quien mantenga el código)

1. Sube el número de versión en **tres** sitios, todos iguales:
   - `inergo-core.js` → `APP_VERSION`
   - `sw.js` → `VERSION`
   - `inergo.html` → todos los `?v=` (`inergo.css` y los cuatro `.js`)
2. Si cambiaste clases o estilos, regenera el CSS (abajo).
3. Pasa los tests (abajo).

Si se olvida subir la versión, los usuarios con la app instalada pueden seguir viendo CSS/JS antiguos.

### Regenerar el CSS

Los estilos se escriben en `tools/tailwind.input.css` y se compilan a `inergo.css`. Desde la raíz del repo:

```bash
npx tailwindcss@3 -c tools/tailwind.config.js -i tools/tailwind.input.css -o inergo.css --minify
```

### Tests

```bash
node --test tests/core.test.js
```

Cubren: catálogo íntegro (103 retos), XP por categoría, sorteo (filtros, pendientes, desactivados, repeticiones), racha en hora local (incluido el cambio de hora), total de retos, reto activo y temporizador con la app cerrada, migración desde la v1, importación de copias manipuladas.

## Probar en local

```bash
python3 -m http.server 8000
# http://localhost:8000/inergo.html
```

El service worker solo funciona por `https://` o `localhost`.

## Instalar como app

- **iPhone (Safari):** Compartir → «Añadir a pantalla de inicio». La app instalada **no comparte el progreso con Safari**: usa *Ajustes → Exportar copia* en Safari e *Importar copia* dentro de la app.
- **Android (Chrome):** *Ajustes → Instalar* dentro de INERGO, o menú ⋮ → «Instalar app».
- **Ordenador (Chrome, Edge):** *Ajustes → Instalar*, o el icono de instalar de la barra de direcciones.

## Datos y privacidad

- El progreso vive en `localStorage` con la clave `inergo_data_v1` (**no cambiarla**: es el progreso de la gente). El formato lleva `schemaVersion` y se migra solo.
- El progreso no sale del dispositivo. La app solo descarga el catálogo de retos (sin enviar datos personales). No hay cookies ni analítica. Solo los administradores inician sesión.
- *Ajustes* permite exportar, importar y borrar todo.

## Seguridad

- `vercel.json` aplica CSP estricta (solo recursos propios, sin scripts en línea), `nosniff`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` (cámara y micrófono permitidos solo para la propia app, de cara a la futura «Caja Negra»).
- Todo texto escrito por el usuario o importado se valida y se escapa antes de pintarse.
- La CSP solo permite conectar con el propio dominio y con el proyecto de Supabase. Si se añade otro servicio (analítica…), hay que añadir su dominio a `connect-src`.
- Permisos garantizados por la base de datos: cualquiera lee los retos activos; solo administradores (email confirmado en `private.admin_emails`) crean, editan o desactivan. Probado como visitante anónimo, como usuario normal y con un token falsificado con el email del administrador.
