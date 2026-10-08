/* =========================================================
   INERGO — Service worker
   ---------------------------------------------------------
   · HTML: primero la red (así cada versión nueva llega a la primera),
     con la copia guardada como respaldo si no hay conexión.
   · CSS/JS versionados (?v=), fuentes e iconos: primero la caché
     (carga instantánea); el ?v= garantiza que nunca se mezclan versiones.
   · Al publicar una versión nueva, sube VERSION aquí y el ?v= en
     inergo.html (ver README → "Publicar una versión nueva").
========================================================= */
const VERSION = "2.1.0";
const CACHE_NAME = "inergo-" + VERSION;
const HTML_FALLBACK = "./inergo.html";

const APP_SHELL = [
  "./",
  "./inergo.html",
  "./inergo.css?v=" + VERSION,
  "./js/inergo-config.js?v=" + VERSION,
  "./js/inergo-core.js?v=" + VERSION,
  "./js/inergo-cloud.js?v=" + VERSION,
  "./js/inergo-app.js?v=" + VERSION,
  "./fonts/inter-latin-var.woff2",
  "./fonts/manrope-latin-var.woff2",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("inergo-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirstHTML(request){
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: true })
      .then((r) => r || caches.match(HTML_FALLBACK))
      .then((r) => r || new Response("<h1>INERGO</h1><p>Sin conexión.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } }));

    // Con mala cobertura no hacemos esperar más de 4 s: se abre la copia guardada.
    const timer = setTimeout(() => {
      if(settled) return;
      fallback().then((r) => { if(!settled){ settled = true; resolve(r); } });
    }, 4000);

    fetch(request).then((response) => {
      if(response && response.ok && response.type === "basic"){
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(HTML_FALLBACK, copy));
      }
      if(!settled){ settled = true; clearTimeout(timer); resolve(response); }
    }).catch(() => {
      if(settled) return;
      clearTimeout(timer);
      fallback().then((r) => { settled = true; resolve(r); });
    });
  });
}

function cacheFirst(request){
  return caches.match(request).then((cached) => {
    if(cached) return cached;
    return fetch(request).then((response) => {
      if(response && response.ok && response.type === "basic"){
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request){
  return caches.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if(response && response.ok && response.type === "basic"){
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if(request.method !== "GET") return;
  const url = new URL(request.url);
  // Solo gestionamos lo nuestro; cualquier servicio externo futuro va directo a la red.
  if(url.origin !== self.location.origin) return;

  if(request.mode === "navigate"){
    event.respondWith(networkFirstHTML(request));
    return;
  }
  if(url.searchParams.has("v") || url.pathname.startsWith("/fonts/")){
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
