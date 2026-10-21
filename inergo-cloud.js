/* =========================================================
   INERGO — conexión con Supabase
   ---------------------------------------------------------
   Cliente mínimo sobre la API REST de Supabase (sin librerías):
   · catálogo de retos (lectura pública, con copia para usar sin conexión)
   · inicio de sesión con un enlace enviado al email (plantillas de serie de Supabase)
   · alta, edición y activación de retos (solo administradores; lo
     garantiza la base de datos, no este archivo)
   Depende de inergo-config.js (window.INERGO_CONFIG).
========================================================= */
(function(){
  "use strict";

  const cfg = window.INERGO_CONFIG || {};
  const AUTH_KEY = "inergo_auth_v1";
  const CATALOG_KEY = "inergo_catalog_v1";
  const SELECT = "id,text,category,duration_type,duration_seconds,research_seconds,talk_seconds,points,active,sort_order,updated_at";

  function enabled(){ return !!(cfg.supabaseUrl && cfg.supabaseKey); }

  /* ---------- Almacenamiento local ---------- */
  function readJSON(key){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch(e){ return null; }
  }
  function writeJSON(key, value){
    try{
      if(value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    }catch(e){}
  }

  /* ---------- Sesión ---------- */
  function decodeJwt(token){
    try{
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(atob(part).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
      return JSON.parse(json);
    }catch(e){ return null; }
  }

  function storeSession(payload){
    if(!payload || !payload.access_token || !payload.refresh_token) throw new Error("Respuesta de inicio de sesión incompleta.");
    const claims = decodeJwt(payload.access_token) || {};
    const expiresAt = Number(payload.expires_at) || (claims.exp ? claims.exp : Math.floor(Date.now()/1000) + (Number(payload.expires_in) || 3600));
    const session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: expiresAt,
      email: (payload.user && payload.user.email) || claims.email || "",
      anonymous: payload.user ? !!payload.user.is_anonymous : !!claims.is_anonymous
    };
    writeJSON(AUTH_KEY, session);
    return session;
  }

  function getSession(){
    const s = readJSON(AUTH_KEY);
    return s && s.access_token && s.refresh_token ? s : null;
  }

  function clearSession(){ writeJSON(AUTH_KEY, null); }

  /* ---------- Peticiones ---------- */
  function friendlyError(status, body){
    const raw = (body && (body.msg || body.error_description || body.message || body.error)) || "";
    if(status === 0) return "Sin conexión con el servidor.";
    if(/not authorized|not allowed/i.test(raw) && /email/i.test(raw)) return "Ese email aún no puede recibir enlaces. Usa el de tu cuenta de Supabase.";
    if(/rate limit|too many|for security purposes/i.test(raw) || status === 429) return "Demasiados intentos. Espera un minuto y vuelve a probar.";
    if(/expired|invalid/i.test(raw) && /token|otp|code|link/i.test(raw)) return "El enlace ha caducado o ya se usó. Pide uno nuevo.";
    if(/row-level security|permission denied/i.test(raw) || status === 403) return "Esta cuenta no tiene permisos para hacer eso.";
    if(status === 401) return "La sesión ha caducado. Vuelve a entrar.";
    // Códigos propios de las funciones de INERGO (supabase/migrations).
    const own = {
      limite_abandonos: "Ya has usado tu abandono de esta semana. Solo puedes abandonar si el reto es peligroso.",
      reto_no_disponible: "Ese reto ya no está activo.",
      sin_retos: "No hay retos en esta categoría todavía.",
      necesitas_cuenta_y_prueba: "Para salir en la tripulación necesitas cuenta, usuario y el enlace de tu vídeo.",
      ya_importado: "Tu progreso ya estaba guardado.",
      falta_enlace: "Pega el enlace de tu vídeo.",
      barco_cerrado: "Este Barco ya ha zarpado. Espera al de la semana que viene.",
      reto_abierto: "Primero termina o abandona el reto que tienes abierto.",
      ya_en_el_barco: "Ya te subiste a este Barco.",
      solo_admin: "Solo administradores.",
      user_already_exists: "Ya hay una cuenta con ese email. Entra con tu contraseña.",
      email_exists: "Ya hay una cuenta con ese email. Entra con tu contraseña.",
      invalid_credentials: "Email o contraseña incorrectos.",
      weak_password: "La contraseña es demasiado débil: usa al menos 8 caracteres.",
      anonymous_provider_disabled: "El acceso sin cuenta no está activado en el servidor.",
      email_provider_disabled: "El acceso con email no está activado en el servidor.",
      email_not_confirmed: "Ese email aún no está confirmado."
    };
    const code = (body && (body.error_code || body.code)) || "";
    if(own[raw]) return own[raw];
    if(own[code]) return own[code];
    if(/invalid login credentials/i.test(raw)) return own.invalid_credentials;
    if(/already registered|already been registered/i.test(raw)) return own.user_already_exists;
    if(/password should be/i.test(raw)) return own.weak_password;
    if(/profiles_username_format/i.test(raw)) return "Usuario: 3-24 letras minúsculas, números, punto o guion bajo.";
    if(/profiles_username_key/i.test(raw)) return "Ese usuario ya está cogido. Prueba con otro.";
    if(/draws_evidence/i.test(raw)) return "El enlace tiene que ser de TikTok, Instagram o YouTube (https).";
    if(/duplicate key/i.test(raw)) return "Ya existe un reto con ese identificador.";
    if(/check constraint/i.test(raw)) return "El reto no cumple las reglas del catálogo.";
    return raw ? String(raw).slice(0, 140) : "Algo ha fallado (" + status + ").";
  }

  async function request(path, { method = "GET", body, auth = false, headers = {}, timeout = 9000 } = {}){
    if(!enabled()) throw new Error("La conexión con el servidor no está configurada.");
    const h = Object.assign({ apikey: cfg.supabaseKey }, headers);
    if(body !== undefined) h["Content-Type"] = "application/json";
    if(auth){
      const session = await validSession();
      if(!session) throw new Error("Inicia sesión para continuar.");
      h.Authorization = "Bearer " + session.access_token;
    }
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let res;
    try{
      res = await fetch(cfg.supabaseUrl + path, {
        method, headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
        cache: "no-store",
        credentials: "omit"
      });
    }catch(e){
      throw new Error(friendlyError(0));
    }finally{
      if(timer) clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try{ data = text ? JSON.parse(text) : null; }catch(e){ data = text; }
    if(!res.ok){
      const err = new Error(friendlyError(res.status, data));
      err.status = res.status;
      err.code = (data && (data.message || data.error_code || data.code)) || "";
      throw err;
    }
    return data;
  }

  // Devuelve una sesión válida, renovándola si está a punto de caducar.
  let refreshing = null;
  async function validSession(){
    const s = getSession();
    if(!s) return null;
    if(s.expires_at - 60 > Date.now() / 1000) return s;
    if(!refreshing){
      refreshing = request("/auth/v1/token?grant_type=refresh_token", { method:"POST", body:{ refresh_token: s.refresh_token } })
        .then(storeSession)
        .catch((e) => { if(e.status === 400 || e.status === 401) clearSession(); throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  /* ---------- Catálogo ---------- */
  async function fetchCatalog({ includeInactive = false } = {}){
    const filter = includeInactive ? "" : "&active=eq.true";
    const useAuth = includeInactive && !!getSession();
    return request("/rest/v1/challenges?select=" + SELECT + filter + "&order=sort_order.asc,created_at.asc", { auth: useAuth });
  }
  function readCachedCatalog(){
    const c = readJSON(CATALOG_KEY);
    return c && Array.isArray(c.rows) ? c : null;
  }
  function saveCachedCatalog(rows){ writeJSON(CATALOG_KEY, { savedAt: Date.now(), rows }); }

  /* ---------- Inicio de sesión ---------- */
  // Envía un enlace de acceso al email. Con las plantillas de serie de
  // Supabase: la primera vez llega «Confirm your signup» y después «Magic Link».
  // Al abrirlo, Supabase devuelve a la app con la sesión en la URL.
  async function sendLink(email){
    const clean = String(email || "").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Escribe un email válido.");
    const redirect = encodeURIComponent(window.location.origin + "/");
    await request("/auth/v1/otp?redirect_to=" + redirect, { method:"POST", body:{ email: clean, create_user: true } });
    return clean;
  }

  // Vuelta desde el enlace del email: la sesión llega en la URL (#access_token=…)
  // o, si el enlace ha caducado, un error (#error_description=… o ?error_description=…).
  function consumeUrlSession(){
    const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search || "");
    const errorDesc = hashParams.get("error_description") || queryParams.get("error_description");
    if(!hashParams.get("access_token") && !errorDesc) return null;
    const keep = new URLSearchParams(window.location.search || "");
    ["error", "error_code", "error_description"].forEach(k => keep.delete(k));
    const rest = keep.toString();
    const clean = () => window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : ""));
    if(errorDesc){
      clean();
      const code = hashParams.get("error_code") || queryParams.get("error_code") || "";
      const expired = code === "otp_expired" || /expired|invalid/i.test(errorDesc);
      return { error: expired ? "El enlace ha caducado o ya se usó. Pide uno nuevo." : "No se pudo iniciar sesión con ese enlace. Pide uno nuevo." };
    }
    const params = hashParams;
    try{
      const session = storeSession({
        access_token: params.get("access_token"),
        refresh_token: params.get("refresh_token"),
        expires_at: params.get("expires_at"),
        expires_in: params.get("expires_in")
      });
      clean();
      return { session };
    }catch(e){
      clean();
      return { error: e.message };
    }
  }

  async function signOut(){
    const s = getSession();
    clearSession();
    if(s){
      try{
        await fetch(cfg.supabaseUrl + "/auth/v1/logout", {
          method:"POST", headers:{ apikey: cfg.supabaseKey, Authorization: "Bearer " + s.access_token }, credentials:"omit"
        });
      }catch(e){}
    }
  }

  async function isAdmin(){
    if(!getSession()) return false;
    const r = await request("/rest/v1/rpc/is_admin", { method:"POST", body:{}, auth:true });
    return r === true;
  }

  /* ---------- Gestión del catálogo (solo admin) ---------- */
  async function createChallenge(row){
    const rows = await request("/rest/v1/challenges?select=" + SELECT, {
      method:"POST", body: row, auth:true, headers:{ Prefer:"return=representation" }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function updateChallenge(id, patch){
    const rows = await request("/rest/v1/challenges?id=eq." + encodeURIComponent(id) + "&select=" + SELECT, {
      method:"PATCH", body: patch, auth:true, headers:{ Prefer:"return=representation" }
    });
    if(!Array.isArray(rows) || rows.length === 0) throw new Error("Esta cuenta no tiene permisos para hacer eso.");
    return rows[0];
  }

  /* ---------- Cuentas de usuario ---------- */
  function isRegistered(){ const s = getSession(); return !!(s && !s.anonymous && s.email); }

  // Sesión anónima: cualquiera puede jugar sin registrarse y el reto queda
  // guardado en el servidor desde el primer giro.
  let anonPending = null;
  async function ensureSession(){
    const s = await validSession().catch(() => null);
    if(s) return s;
    if(!anonPending){
      anonPending = request("/auth/v1/signup", { method:"POST", body:{ data:{} } })
        .then(storeSession)
        .finally(() => { anonPending = null; });
    }
    return anonPending;
  }

  function cleanEmail(email){
    const e = String(email || "").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Escribe un email válido.");
    return e;
  }
  function checkPassword(pw){
    if(typeof pw !== "string" || pw.length < 8) throw new Error("La contraseña necesita al menos 8 caracteres.");
    return pw;
  }

  // Crear cuenta. Si ya juegas como anónimo, se convierte la MISMA cuenta
  // (conserva tus retos); si no, se crea una nueva.
  async function signUp(email, password){
    const e = cleanEmail(email), pw = checkPassword(password);
    const s = await validSession().catch(() => null);
    if(s && s.anonymous){
      try{
        // Supabase exige poner primero el email y después la contraseña.
        await request("/auth/v1/user", { method:"PUT", body:{ email: e }, auth:true });
        await request("/auth/v1/user", { method:"PUT", body:{ password: pw }, auth:true });
        // El token antiguo dice "anónimo": se renueva para que el servidor lo sepa.
        const fresh = await request("/auth/v1/token?grant_type=refresh_token", { method:"POST", body:{ refresh_token: s.refresh_token } });
        const stored = storeSession(fresh);
        if(!stored.anonymous) return stored;
      }catch(err){
        // Email ya usado, contraseña débil…: el mensaje sirve tal cual.
        if(/email_exists|user_already_exists|weak_password/.test(err.code || "")) throw err;
      }
      // Si el servidor no deja convertir la cuenta anónima (p. ej. pide
      // confirmar el email), se crea una cuenta nueva. El progreso del móvil
      // se sube igualmente con import_legacy_progress.
    }
    const r = await request("/auth/v1/signup", { method:"POST", body:{ email: e, password: pw } });
    if(!r || !r.access_token) throw new Error("Revisa tu email para confirmar la cuenta y luego entra.");
    return storeSession(r);
  }

  async function signIn(email, password){
    const e = cleanEmail(email);
    if(!password) throw new Error("Escribe tu contraseña.");
    const r = await request("/auth/v1/token?grant_type=password", { method:"POST", body:{ email: e, password } });
    return storeSession(r);
  }

  /* ---------- Funciones del servidor (supabase/migrations) ---------- */
  async function rpc(name, args){
    if(!/^[a-z_]{3,40}$/.test(name)) throw new Error("Función desconocida.");
    await ensureSession();
    return request("/rest/v1/rpc/" + name, { method:"POST", body: args || {}, auth:true });
  }

  /* Cola de envíos pendientes: si una llamada falla por la red, se guarda y
     se reintenta en orden (al abrir la app, al recuperar conexión y antes de
     cada sorteo). Los errores de reglas (4xx) no se reintentan. */
  const OUTBOX_KEY = "inergo_outbox_v1";
  const OUTBOX_FNS = ["start_draw","save_pending","complete_draw","abandon_draw","admin_skip_draw","confirm_adult","import_legacy_progress"];
  function readOutbox(){ const q = readJSON(OUTBOX_KEY); return Array.isArray(q) ? q.filter(j => j && OUTBOX_FNS.includes(j.fn)).slice(0, 50) : []; }
  function enqueue(fn, args){
    const q = readOutbox(); q.push({ fn, args: args || {}, at: Date.now() }); writeJSON(OUTBOX_KEY, q);
    return flushOutbox();
  }
  let flushing = null;
  function flushOutbox(){
    if(!enabled()) return Promise.resolve();
    if(flushing) return flushing;
    flushing = (async () => {
      let q = readOutbox();
      while(q.length){
        const job = q[0];
        try{ await rpc(job.fn, job.args); }
        catch(e){
          if(!e.status || e.status >= 500 || e.status === 401) break; // red o servidor: se reintenta luego
        }
        q = readOutbox().slice(1); writeJSON(OUTBOX_KEY, q.length ? q : null);
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function outboxSize(){ return readOutbox().length; }

  /* ---------- Barco de la semana y perfil (v2.3) ---------- */
  // Lecturas públicas: no crean sesión (así quien solo mira no genera usuarios).
  function publicRpc(name, args){
    return request("/rest/v1/rpc/" + name, { method:"POST", body: args || {} });
  }
  async function currentWeekly(){
    const rows = await publicRpc("current_weekly", {});
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  function weeklyCrew(weeklyId){ return publicRpc("weekly_crew", { p_weekly_id: weeklyId }); }

  function userId(){
    const s = getSession();
    const c = s ? decodeJwt(s.access_token) : null;
    return c && typeof c.sub === "string" ? c.sub : null;
  }
  async function getProfile(){
    const id = userId();
    if(!id) return null;
    const rows = await request("/rest/v1/profiles?id=eq." + encodeURIComponent(id) + "&select=username,display_name,is_public", { auth:true });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async function updateProfile(patch){
    const id = userId();
    if(!id) throw new Error("Inicia sesión para continuar.");
    const rows = await request("/rest/v1/profiles?id=eq." + encodeURIComponent(id) + "&select=username,display_name,is_public", {
      method:"PATCH", body: patch, auth:true, headers:{ Prefer:"return=representation" }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function createWeekly(row){
    const rows = await request("/rest/v1/weekly_challenges?select=id,title,challenge_id,starts_at,ends_at", {
      method:"POST", body: row, auth:true, headers:{ Prefer:"return=representation" }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  window.InergoCloud = {
    currentWeekly, weeklyCrew, getProfile, updateProfile, createWeekly,
    AUTH_KEY, enabled, getSession, clearSession, signOut, sendLink, consumeUrlSession, isAdmin,
    fetchCatalog, readCachedCatalog, saveCachedCatalog, createChallenge, updateChallenge,
    ensureSession, isRegistered, signUp, signIn, rpc, enqueue, flushOutbox, outboxSize
  };
})();
