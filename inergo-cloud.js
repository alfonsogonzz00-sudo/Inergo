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
      email: (payload.user && payload.user.email) || claims.email || ""
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

  window.InergoCloud = {
    AUTH_KEY, enabled, getSession, clearSession, signOut, sendLink, consumeUrlSession, isAdmin,
    fetchCatalog, readCachedCatalog, saveCachedCatalog, createChallenge, updateChallenge
  };
})();
