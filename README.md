# INERGO — Te toca.

App web instalable (PWA) que propone un reto incómodo para que lo hagas y lo grabes. HTML + CSS + JavaScript sin framework. Sin backend: todo el progreso se guarda en el navegador (`localStorage`).

**Flujo:** abrir INERGO → elegir categoría → PLAY → sorteo → aparece el reto → TE TOCA → EMPEZAR / INVESTIGAR / APUNTAR → LO HE HECHO → se actualiza el progreso.

**Regla central:** una vez pulsado PLAY, el reto no se puede rechazar, cambiar ni saltar. Desde la v2 esto se cumple también si sales a la home, recargas o cierras la app: al volver, INERGO te devuelve al mismo reto.

## Modo pruebas (solo para testear)

Permite **saltar un reto ya revelado** sin completarlo (no suma XP ni racha). Para cualquier otro usuario la regla sigue intacta.

- **Activar:** abre `inergo.vercel.app/?test=1`, o en la app instalada ve a **Ajustes y toca 5 veces el texto de la versión** (abajo del todo).
- **Se nota:** en la home aparece la etiqueta negra «MODO PRUEBAS» y, durante un reto, el enlace «Saltar reto · modo pruebas».
- **Desactivar:** interruptor «Modo pruebas» en Ajustes, `?test=0` o otros 5 toques en la versión. **Desactívalo antes de grabar.**

---

## Estructura

```
inergo.html              ← la app (solo marcado; sin código en línea)
inergo.css               ← estilos COMPILADOS (no editar a mano)
js/inergo-core.js        ← lógica pura: catálogo de retos, sorteo, XP, racha, reto activo, copias
js/inergo-app.js         ← interfaz: pantallas, animaciones, sonido, ajustes
fonts/                   ← Inter y Manrope autoalojadas (funcionan sin conexión)
manifest.json            ← datos de instalación (nombre, iconos, accesos directos)
sw.js                    ← service worker: offline y actualizaciones
vercel.json              ← "/" carga inergo.html + cabeceras de seguridad
og-image.png             ← imagen al compartir el enlace (WhatsApp, Instagram…)
icon-*.png, apple-touch-icon.png
tools/                   ← fuente del CSS y configuración de Tailwind (no se usa en producción)
tests/                   ← tests de la lógica crítica
docs/ROADMAP.md          ← lo siguiente: cuentas, sincronización, push, analítica
```

## Subir a GitHub (sin terminal)

1. Abre el repositorio en GitHub desde **Chrome** → **Add file → Upload files**.
2. Arrastra **todo el contenido** de la carpeta `inergo` (archivos **y** carpetas `js`, `fonts`, `tools`, `tests`, `docs`).
3. Mensaje del commit, por ejemplo `INERGO v2.0.1`, y **Commit changes**.
4. Vercel despliega solo en 1-2 minutos.

No hay que borrar nada del repositorio: los archivos con el mismo nombre se sustituyen y el resto son nuevos. No hay que tocar la configuración de Vercel (sigue siendo un sitio estático, sin paso de compilación).

**Quien ya tenga la app instalada** verá la versión nueva la segunda vez que la abra (la primera el móvil descarga la actualización en segundo plano). Su progreso se conserva.

## Publicar una versión nueva (para quien mantenga el código)

1. Sube el número de versión en **tres** sitios, todos iguales:
   - `js/inergo-core.js` → `APP_VERSION`
   - `sw.js` → `VERSION`
   - `inergo.html` → los tres `?v=` de `inergo.css`, `inergo-core.js` e `inergo-app.js`
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

- Todo vive en `localStorage` con la clave `inergo_data_v1` (**no cambiarla**: es el progreso de la gente). El formato lleva `schemaVersion` y se migra solo.
- Ningún dato sale del dispositivo. No hay cookies, cuentas ni analítica.
- *Ajustes* permite exportar, importar y borrar todo.

## Seguridad

- `vercel.json` aplica CSP estricta (solo recursos propios, sin scripts en línea), `nosniff`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` (cámara y micrófono permitidos solo para la propia app, de cara a la futura «Caja Negra»).
- Todo texto escrito por el usuario o importado se valida y se escapa antes de pintarse.
- Si en el futuro se añade un servicio externo (Supabase, analítica), hay que añadir su dominio a `connect-src` en la CSP.
