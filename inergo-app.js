/* =========================================================
   INERGO — interfaz
   Depende de inergo-core.js (window.InergoCore).
========================================================= */
(function(){
  "use strict";

  const Core = window.InergoCore;
  const {
    CATEGORIES, MICROCOPY, SPIN_PHRASE, STORAGE_KEY,
    CUSTOM_CHALLENGE_POINTS, APP_VERSION, mk
  } = Core;

  /* =========================================================
     1. LOCALSTORAGE
  ========================================================= */
  let storageOk = true;
  let data = loadData();

  function loadData(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return Core.defaultData();
      return Core.normalizeData(JSON.parse(raw));
    }catch(e){
      console.warn("No se pudo leer localStorage, usando datos por defecto.", e);
      return Core.defaultData();
    }
  }

  function saveData(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageOk = true;
    }catch(e){
      // Modo privado, almacenamiento lleno o bloqueado: la app sigue funcionando
      // en memoria, pero avisamos una vez para que nadie pierda progreso sin saberlo.
      if(storageOk) showToast("No se puede guardar el progreso en este navegador.");
      storageOk = false;
      console.warn("No se pudo guardar en localStorage.", e);
    }
  }

  /* =========================================================
     2. ESTADO DE LA APP (en memoria; lo persistente está en data)
  ========================================================= */
  const state = {
    screen: "home",
    spinHandle: null,       // requestAnimationFrame del carrete
    revealTimeout: null,
    timerHandle: null,      // setInterval de la cuenta atrás
    lastRenderedSecond: null,
    typewriterHandle: null,
    editingChallengeId: null,
    pendingUpdate: false
  };

  const reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches:false };

  /* =========================================================
     3. UTILIDADES
  ========================================================= */
  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

  function categoryLabel(id){
    const c = CATEGORIES.find(c => c.id === id);
    return c ? c.label : String(id).toUpperCase();
  }

  function formatDuration(challenge){
    if(challenge.durationType === "research"){
      return Math.round(challenge.researchDuration/60) + " MIN + " + Math.round(challenge.talkDuration/60) + " MIN";
    }
    const min = Math.round(challenge.duration / 60);
    return min + " MIN";
  }

  function formatTimer(seconds){
    const m = Math.floor(seconds / 60).toString().padStart(2,"0");
    const s = Math.floor(seconds % 60).toString().padStart(2,"0");
    return m + ":" + s;
  }

  function escapeHtml(str){
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function showToast(msg){
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(()=> t.classList.remove("show"), 2200);
  }

  function announce(msg){
    const el = $("#sr-announcer");
    el.textContent = "";
    // Pequeño retardo para que el lector de pantalla detecte el cambio.
    setTimeout(() => { el.textContent = msg; }, 60);
  }

  /* =========================================================
     4. SONIDO (Web Audio API, sin archivos externos)
  ========================================================= */
  let audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx){
      try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ audioCtx = null; }
    }
    // iOS (sobre todo instalada como app desde pantalla de inicio) arranca el
    // AudioContext "suspendido" hasta que se reanuda dentro de un gesto real.
    if(audioCtx && audioCtx.state === "suspended"){
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Desbloqueo temprano: en el primer toque/click se crea y reanuda el
  // AudioContext, aunque ese primer toque no vaya a sonar nada.
  function unlockAudioOnce(){
    getAudioCtx();
    document.removeEventListener("touchend", unlockAudioOnce);
    document.removeEventListener("click", unlockAudioOnce);
  }
  document.addEventListener("touchend", unlockAudioOnce, { once:true });
  document.addEventListener("click", unlockAudioOnce, { once:true });

  // Sonido y vibración solo tras una interacción real: los navegadores los
  // bloquean antes (p. ej. al reabrir la app y que el reloj acabe solo).
  let userInteracted = false;
  ["pointerdown","keydown","touchstart"].forEach(ev =>
    document.addEventListener(ev, () => { userInteracted = true; }, { capture:true, passive:true }));
  function hasUserActivation(){
    if(navigator.userActivation) return navigator.userActivation.hasBeenActive;
    return userInteracted;
  }

  function beep({freq=440, duration=0.05, type="sine", gain=0.06, delay=0}){
    if(!data.soundOn || !hasUserActivation()) return;
    const ctx = getAudioCtx();
    if(!ctx) return;
    try{
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + delay;
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }catch(e){ /* el audio nunca debe romper el flujo */ }
  }

  // Timbre distinto por categoría: antes de leer el reto, el oído ya intuye qué toca.
  const CATEGORY_REVEAL_TONES = {
    espontanea:   [520, 780],
    experiencia:  [420, 630, 840],
    reflexion:    [360, 540],
    conocimiento: [500, 700, 940]
  };

  const Sound = {
    clickPlay(){ beep({freq:220, duration:0.09, type:"square", gain:0.05}); },
    // El tick del carrete sube de tono según se acerca la revelación (0 = inicio, 1 = final)
    tick(progress){
      const freq = 620 + Math.min(1, Math.max(0, progress || 0)) * 680;
      beep({freq, duration:0.02, type:"square", gain:0.03});
    },
    reveal(category){
      const tones = CATEGORY_REVEAL_TONES[category] || [520, 780];
      tones.forEach((freq, i) => {
        beep({freq, duration:0.14 + i*0.02, type:"sine", gain:0.065, delay:i*0.08});
      });
    },
    // Últimos 5 segundos: un pulso seco por segundo.
    countdown(secondsLeft){
      beep({freq: secondsLeft === 1 ? 990 : 760, duration:0.045, type:"sine", gain:0.045});
    },
    // Fin del tiempo.
    timeUp(){
      beep({freq:660, duration:0.12, type:"triangle", gain:0.07});
      beep({freq:440, duration:0.24, type:"triangle", gain:0.07, delay:0.13});
    },
    complete(){
      beep({freq:440, duration:0.12, type:"sine", gain:0.07});
      beep({freq:660, duration:0.16, type:"sine", gain:0.07, delay:0.1});
      beep({freq:880, duration:0.22, type:"sine", gain:0.07, delay:0.2});
    }
  };

  // Vibración (Android/Chrome; iOS Safari no expone navigator.vibrate a las
  // apps web, así que ahí simplemente no hace nada, sin errores).
  const canVibrate = typeof navigator.vibrate === "function";
  function vibrate(pattern){
    if(!data.hapticsOn || !canVibrate || !hasUserActivation()) return;
    try{ navigator.vibrate(pattern); }catch(e){}
  }

  /* =========================================================
     5. PANTALLA ENCENDIDA durante el reto (si el navegador lo permite)
     Clave al grabar: que el móvil no se bloquee a mitad de un reto.
  ========================================================= */
  let wakeLock = null;
  async function requestWakeLock(){
    if(!("wakeLock" in navigator) || wakeLock || document.visibilityState !== "visible") return;
    try{
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }catch(e){ wakeLock = null; }
  }
  function releaseWakeLock(){
    if(wakeLock){ wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  /* =========================================================
     6. EFECTOS DE REVELACIÓN
  ========================================================= */
  function retrigger(el, cls){
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  // Flash blanco sincronizado con la revelación del reto.
  function triggerRevealFlash(){ retrigger($("#reveal-flash"), "flash-active"); }
  // Sacudida breve + onda expansiva: refuerzan el "golpe" visual.
  function triggerRevealShake(){ retrigger($("#screen-play"), "shake-active"); }
  function triggerShockwave(){ retrigger($("#reveal-shockwave"), "shockwave-active"); }

  // Efecto máquina de escribir: el texto del reto aparece letra a letra.
  function typewriterReveal(el, text){
    clearTimeout(state.typewriterHandle);
    el.textContent = "";
    const speed = Math.max(10, Math.min(26, 700 / Math.max(text.length, 1)));
    let i = 0;
    function step(){
      i++;
      el.textContent = text.slice(0, i);
      if(i < text.length){
        state.typewriterHandle = setTimeout(step, speed);
      }
    }
    step();
  }

  /* =========================================================
     7. NAVEGACIÓN
  ========================================================= */
  const SCREENS_WITH_HEADING = ["pending","progress","mychallenges","settings","admin","barco"];

  function leavePlayScreen(){
    stopCountdown();
    cancelAnimationFrame(state.spinHandle);
    state.spinHandle = null;
    clearTimeout(state.revealTimeout);
    clearTimeout(state.typewriterHandle);
    releaseWakeLock();
    // Si el carrete estaba girando, el reto ya está decidido y guardado:
    // al volver se revelará directamente.
  }

  function goTo(screenName, opts){
    const options = opts || {};
    if(state.screen === "play" && screenName !== "play") leavePlayScreen();
    state.screen = screenName;
    $(".app-shell").dataset.activeScreen = screenName;
    $all(".screen").forEach(el => el.classList.toggle("active", el.dataset.screen === screenName));
    if(screenName === "home") renderHome();
    if(screenName === "progress") renderProgress();
    if(screenName === "mychallenges") renderMyChallenges();
    if(screenName === "pending") renderPendingChallenges();
    if(screenName === "settings") renderSettings();
    if(screenName === "admin") renderAdmin();
    if(screenName === "barco") renderBarco();
    if(screenName === "play") requestWakeLock();
    window.scrollTo(0,0);
    // Accesibilidad: al cambiar de pantalla el foco va al título.
    if(!options.silentFocus && SCREENS_WITH_HEADING.includes(screenName)){
      const h = $("#screen-" + screenName + " .screen-heading");
      if(h) h.focus({ preventScroll:true });
    }
    if(screenName === "home" && state.pendingUpdate) showUpdateBanner();
  }

  $all("[data-nav]").forEach(btn => btn.addEventListener("click", () => goTo(btn.dataset.nav)));

  /* ---------- HOME ---------- */
  function renderCategorySelector(){
    const wrap = $("#category-selector");
    wrap.innerHTML = "";
    CATEGORIES.forEach(cat => {
      const b = document.createElement("button");
      const selected = data.selectedCategory === cat.id;
      b.className = "chip rounded-full px-4 py-2 font-display font-bold text-xs tracking-wide shrink-0" + (selected ? " selected" : "");
      b.textContent = cat.label;
      b.setAttribute("aria-pressed", selected ? "true" : "false");
      b.addEventListener("click", () => {
        data.selectedCategory = cat.id;
        saveData();
        renderCategorySelector();
        renderAvailableCount();
        const again = $all("#category-selector .chip").find(el => el.textContent === cat.label);
        if(again) again.focus({ preventScroll:true });
      });
      wrap.appendChild(b);
    });
  }

  function renderAvailableCount(){
    const el = $("#available-count");
    if(data.activeChallenge){
      el.textContent = "TIENES UN RETO EN MARCHA";
      return;
    }
    const pool = Core.poolFor(data, data.selectedCategory);
    el.textContent = pool.length + (pool.length === 1 ? " RETO DISPONIBLE" : " RETOS DISPONIBLES");
  }

  function renderStreak(){
    const el = $("#home-streak");
    const streak = Core.effectiveStreak(data);
    if(streak > 0){
      el.textContent = streak + (streak === 1 ? " día seguido" : " días seguidos");
      el.classList.remove("hidden");
    }else{
      el.classList.add("hidden");
    }
  }

  function renderPlayButton(){
    const btn = $("#play-btn");
    if(data.activeChallenge){
      btn.textContent = "TU RETO";
      btn.classList.add("is-resume");
      btn.setAttribute("aria-label", "Volver a tu reto en marcha");
    }else{
      btn.textContent = "PLAY";
      btn.classList.remove("is-resume");
      btn.setAttribute("aria-label", "PLAY, sortear un reto");
    }
  }

  function renderHome(){
    renderBarcoPill();
    renderTestModeUI();
    renderCategorySelector();
    renderAvailableCount();
    renderStreak();
    renderPlayButton();
  }

  /* =========================================================
     8. FLUJO PLAY
     Desde que se pulsa PLAY, el reto queda guardado en data.activeChallenge.
     Salir, recargar o cerrar la app no permite tirar otra vez.
  ========================================================= */
  function launchChallenge(chosen){
    Sound.clickPlay();
    vibrate(15);
    retrigger($("#play-burst"), "burst-active");
    data.activeChallenge = Core.createActive(chosen);
    saveData();
    // Pequeña pausa para que el estallido de líneas llegue a verse antes de
    // cambiar de pantalla (si no, el home se oculta antes de pintarse el frame).
    setTimeout(() => {
      goTo("play");
      startSpin(data.activeChallenge.challenge);
    }, 160);
  }

  /* ---------- Sorteo en el servidor (v2.2) ----------
     Con conexión, el reto lo elige y lo guarda la base de datos: si ya tienes
     uno abierto (en este u otro dispositivo), te devuelve ese. Sin conexión o
     si el servidor no responde, se sortea en el móvil como antes. */
  const SERVER_DRAW_TIMEOUT = 6000;
  function serverDrawsOn(){ return cloudOn && navigator.onLine !== false; }

  async function serverDraw(category){
    try{
      await Cloud.flushOutbox().catch(() => {});
      const row = await Promise.race([
        Cloud.rpc("draw_challenge", { p_category: category }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), SERVER_DRAW_TIMEOUT))
      ]);
      return Core.challengeFromDraw(Array.isArray(row) ? row[0] : row);
    }catch(e){
      return null;
    }
  }

  // PLAY con el servidor: la ruleta arranca al instante y el reto real se
  // coloca en la última casilla en cuanto llega (normalmente en < 1 s).
  function launchServerDraw(category, { surprise } = {}){
    if(state.drawing) return;
    state.drawing = true;
    Sound.clickPlay();
    vibrate(surprise ? [20, 40, 20, 40, 30] : 15);
    retrigger($("#play-burst"), "burst-active");
    const result = serverDraw(category).then((r) => {
      if(r && (r.status === "revealed" || r.status === "started")) return r;
      // Sin servidor: sorteo local, como siempre.
      const chosen = Core.pickChallenge(drawView(), category);
      return chosen ? { challenge: chosen, drawId: null, local: true } : null;
    }).then((r) => {
      // El compromiso se guarda en cuanto se conoce el reto, aunque hayas
      // salido de la pantalla durante la ruleta.
      if(r && !data.activeChallenge){
        data.activeChallenge = Core.createActive(r.challenge, undefined, r.drawId);
        saveData();
      }
      state.drawing = false;
      if(state.screen === "home") renderPlayButton();
      return r;
    });
    setTimeout(() => {
      goTo("play");
      startSpin(null, { result });
    }, 160);
  }

  $("#play-btn").addEventListener("click", () => {
    if(data.activeChallenge){
      resumeActive();
      return;
    }
    if(serverDrawsOn()){ launchServerDraw(data.selectedCategory); return; }
    const chosen = Core.pickChallenge(drawView(), data.selectedCategory);
    if(!chosen){
      showToast("No hay retos en esta categoría todavía.");
      return;
    }
    launchChallenge(chosen);
  });

  function resumeActive(){
    const active = data.activeChallenge;
    if(!active) return;
    Core.resolveActive(active);
    saveData();
    goTo("play");
    if(active.phase === "spinning"){
      startSpin(active.challenge);
    }else{
      renderActive({ resumed:true });
    }
  }

  function startSpin(finalChallenge, pending){
    state.lastCompleted = null;
    $("#spin-heading-text").textContent = SPIN_PHRASE;

    const phraseRow = $("#phrase-row");
    phraseRow.classList.add("hidden");
    phraseRow.classList.remove("flex");

    $("#spin-wrap").style.display = "flex";
    $("#reveal-wrap").classList.add("hidden");
    $("#reveal-wrap").classList.remove("flex");

    let pool = Core.poolFor(data, data.selectedCategory);
    if(pool.length === 0) pool = Core.poolFor(data, "todos");
    if(pool.length === 0 && finalChallenge) pool = [finalChallenge];
    // Con sorteo en el servidor, la última casilla se rellena cuando llega el reto.
    let resolved = finalChallenge ? { challenge: finalChallenge } : null;
    let arrived = !!finalChallenge;
    const track = $("#reel-track");
    track.innerHTML = "";
    track.style.transform = "translateY(0px)";

    // Medido en vivo: el alto del item siempre coincide con el del viewport
    // (min(26vh, 168px) fijado en CSS), así que la tira encaja en cualquier pantalla.
    const ITEM_H = $(".reel-viewport").getBoundingClientRect().height;
    // La ruleta es parte del producto: se muestra siempre (también con
    // "Reducir movimiento" activado, igual que en la versión original).
    const REEL_LENGTH = 28; // items pintados en la tira
    const sequence = [];
    for(let i=0; i<REEL_LENGTH-1; i++){
      sequence.push(pool[Math.floor(Math.random()*pool.length)]);
    }
    sequence.push(finalChallenge || pool[Math.floor(Math.random()*pool.length)]); // el último siempre es el elegido real

    const reelLabel = (c) => c.text.split(" ").slice(0,5).join(" ") + "…";
    sequence.forEach(c => {
      const div = document.createElement("div");
      div.className = "reel-item";
      const p = document.createElement("p");
      p.className = "font-display font-extrabold text-2xl tight-sm uppercase opacity-90";
      p.textContent = reelLabel(c);
      div.appendChild(p);
      track.appendChild(div);
    });

    if(pending){
      pending.result.then((r) => {
        arrived = true;
        resolved = r;
        if(r){
          const last = track.lastElementChild && track.lastElementChild.querySelector("p");
          if(last) last.textContent = reelLabel(r.challenge);
        }
      });
    }

    // Al terminar la ruleta: con el reto ya elegido, se revela; si el servidor
    // aún no ha contestado, se espera (como mucho el tiempo de SERVER_DRAW_TIMEOUT).
    function finish(){
      if(!arrived){ state.revealTimeout = setTimeout(finish, 120); return; }
      if(!resolved){
        showToast("No hay retos en esta categoría todavía.");
        goTo("home");
        return;
      }
      revealChallenge(data.activeChallenge ? data.activeChallenge.challenge : resolved.challenge);
    }

    // El viewport mide lo mismo que un item, así que el desplazamiento final
    // centra exactamente el último elemento (el reto elegido) en la ventana.
    const finalOffset = -(ITEM_H * (sequence.length - 1));

    // ~3 s desde que pulsas PLAY hasta que aparece el reto
    // (0,16 s de estallido + 2,7 s de ruleta + 0,16 s de pausa).
    const DURATION = 2700;
    const startTime = performance.now();
    let lastTickIndex = -1;

    function easeOutQuint(t){ return 1 - Math.pow(1-t, 5); }

    function frame(now){
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      const eased = easeOutQuint(t);
      const y = eased * finalOffset;
      track.style.transform = `translateY(${y}px)`;

      const currentIndex = Math.min(sequence.length - 1, Math.floor(eased * (sequence.length - 1)));
      if(currentIndex !== lastTickIndex){
        lastTickIndex = currentIndex;
        if(t < 0.92) Sound.tick(t);
      }

      if(t < 1){
        state.spinHandle = requestAnimationFrame(frame);
      }else{
        state.spinHandle = null;
        track.style.transform = `translateY(${finalOffset}px)`;
        state.revealTimeout = setTimeout(finish, 160);
      }
    }
    state.spinHandle = requestAnimationFrame(frame);
  }

  const ACTION_BTN_COMPACT = "btn-invert self-center rounded-full px-7 py-3 font-display font-black text-sm tight-sm uppercase shrink-0";

  // Todas las acciones del flujo usan la píldora compacta (igual que antes).
  function setActionButton(text, onClick){
    const btn = $("#action-btn");
    btn.className = ACTION_BTN_COMPACT;
    btn.textContent = text;
    btn.disabled = false;
    btn.onclick = onClick;
    renderSkipButton();
  }

  /* ---------- MODO PRUEBAS ----------
     Solo para administradores: permite abandonar un reto revelado sin
     completarlo (no suma XP ni racha). ?test=1 o 5 toques en la versión
     solo muestran la entrada de Administración; el modo pruebas se activa
     cuando la base de datos confirma que la sesión es de un administrador. */
  let testAllowed = false;   // confirmado por is_admin() en esta sesión
  let adminDoor = false;     // la entrada de Administración se ha desvelado (solo en memoria)
  function testActive(){ return !!(data.testMode && testAllowed); }
  function renderSkipButton(){
    const skip = $("#skip-btn");
    skip.classList.toggle("hidden", !(testActive() && data.activeChallenge));
    const active = data.activeChallenge;
    const live = !!(active && active.phase !== "spinning");
    const done = !active && !!state.lastCompleted;
    $("#abandon-btn").classList.toggle("hidden", !live);
    $("#share-btn").classList.toggle("hidden", !(live || done));
    $("#evidence-btn").classList.toggle("hidden", !(done && cloudOn && state.lastCompleted.drawId));
  }
  $("#share-btn").addEventListener("click", () => {
    const active = data.activeChallenge;
    if(active) shareCard({ text: active.challenge.text, kind: active.weeklyId ? "barco" : "toca" });
    else if(state.lastCompleted) shareCard({ text: state.lastCompleted.challenge.text, kind: "hecho" });
  });
  $("#evidence-btn").addEventListener("click", () => {
    if(state.lastCompleted) openEvidenceSheet(state.lastCompleted);
  });
  $("#skip-btn").addEventListener("click", () => {
    if(!testActive() || !data.activeChallenge) return;
    syncDraw("admin_skip_draw");
    stopCountdown();
    data.activeChallenge = null;
    saveData();
    showToast("Reto saltado · modo pruebas");
    goTo("home");
  });
  /* ---------- ABANDONO JUSTIFICADO ----------
     El reto no se cambia por otro: se abandona con un motivo y no suma XP.
     Lo decide la base de datos («peligroso» siempre; otros, uno por semana). */
  $("#abandon-btn").addEventListener("click", () => {
    if(!data.activeChallenge) return;
    openSheet({
      title: "¿Por qué no puedes hacerlo?",
      html: `<p>Abandonar no suma XP y no te da otro reto al momento. Si es peligroso, siempre puedes; por otros motivos, una vez por semana.</p>`,
      actions: [
        { label:"Es peligroso", danger:true, onClick: () => abandonActive("peligroso") },
        { label:"Ahora mismo es imposible", onClick: () => abandonActive("imposible") },
        { label:"Cruza un límite personal", onClick: () => abandonActive("limite_personal") },
        { label:"Cancelar" }
      ]
    });
  });

  async function abandonActive(reason){
    const active = data.activeChallenge;
    if(!active) return;
    if(cloudOn && active.drawId){
      try{
        await Cloud.rpc("abandon_draw", { p_draw_id: active.drawId, p_reason: reason });
      }catch(e){
        // Regla de la base de datos (p. ej. límite semanal): el reto sigue.
        if(e.status && e.status < 500 && e.status !== 401){ showToast(e.message); return; }
        // Sin red: se envía más tarde; si el servidor no lo acepta, el reto volverá.
        Cloud.enqueue("abandon_draw", { p_draw_id: active.drawId, p_reason: reason }).catch(() => {});
      }
    }
    stopCountdown();
    data.activeChallenge = null;
    saveData();
    showToast("Reto abandonado. No suma XP.");
    goTo("home");
  }

  function setTestMode(on, { silent } = {}){
    if(on && !testAllowed){
      adminDoor = true;
      renderTestModeUI();
      if(!silent) showToast("Modo pruebas solo para administradores: entra en Ajustes → Administración.");
      return;
    }
    data.testMode = !!on;
    saveData();
    renderTestModeUI();
    if(!silent) showToast(on ? "Modo pruebas activado." : "Modo pruebas desactivado.");
  }
  function renderTestModeUI(){
    $("#test-badge").classList.toggle("hidden", !testActive());
    $("#testmode-row").classList.toggle("hidden", !testAllowed);
    $("#testmode-toggle").checked = testActive();
    renderSkipButton();
    renderAdminEntry();
  }
  function applyTestModeFromUrl(){
    try{
      const url = new URL(window.location.href);
      const t = url.searchParams.get("test");
      if(t !== "1" && t !== "0") return;
      if(t === "1") adminDoor = true;
      setTestMode(t === "1", { silent:true });
      url.searchParams.delete("test");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }catch(e){}
  }

  function setHeadline(text){ $("#reveal-headline").querySelector("p").textContent = text; }

  function showMicroCopy(text){
    const mc = $("#micro-copy");
    if(text){ mc.textContent = text; mc.classList.remove("hidden"); }
    else mc.classList.add("hidden");
  }

  function paintChallenge(challenge, { animate }){
    $("#spin-wrap").style.display = "none";
    const revealWrap = $("#reveal-wrap");
    revealWrap.classList.remove("hidden");
    revealWrap.classList.add("flex");

    const challengeTextEl = $("#challenge-text");
    challengeTextEl.classList.remove("len-md", "len-lg");
    if(challenge.text.length > 85){
      challengeTextEl.classList.add("len-lg");
    }else if(challenge.text.length > 50){
      challengeTextEl.classList.add("len-md");
    }
    if(animate) typewriterReveal(challengeTextEl, challenge.text);
    else challengeTextEl.textContent = challenge.text;
    $("#challenge-meta").textContent = categoryLabel(challenge.category);
    $("#challenge-duration-label").textContent = challenge.durationType === "pending" ? "" : "⏱ " + formatDuration(challenge);

    // Debajo del logo, la frase que acompañó la selección, con su icono de ayuda.
    $("#phrase-label").textContent = SPIN_PHRASE;
    const phraseRow = $("#phrase-row");
    phraseRow.classList.remove("hidden");
    phraseRow.classList.add("flex");
    $("#phrase-tooltip-wrap").style.display = "inline-flex";

    $("#timer-display").classList.add("hidden");
    $("#timer-value").parentElement.classList.remove("timer-urgent");
    showMicroCopy(null);
  }

  function revealChallenge(challenge){
    const active = data.activeChallenge;
    if(!active) return;
    if(active.phase === "spinning"){
      Core.setPhase(active, "revealed");
      Core.registerRecent(data, challenge.id);
      saveData();
    }
    Sound.reveal(challenge.category);
    triggerRevealFlash();
    triggerRevealShake();
    triggerShockwave();
    vibrate([12, 30, 12]);

    paintChallenge(challenge, { animate:true });
    showRevealedState(challenge);
    announce("Te toca. " + categoryLabel(challenge.category) + ". " + challenge.text);

    [$("#reveal-headline"), $("#challenge-card")].forEach(el => retrigger(el, "reveal-enter"));
  }

  function showRevealedState(challenge){
    setHeadline("Te toca.");
    let startLabel = "EMPEZAR";
    if(challenge.durationType === "research") startLabel = "INVESTIGAR";
    else if(challenge.durationType === "pending") startLabel = "APUNTAR";
    setActionButton(startLabel, () => handleStart(challenge));
  }

  // Repinta el reto activo en la fase en la que esté (al volver o recargar).
  function renderActive(){
    const active = data.activeChallenge;
    if(!active) return;
    const c = active.challenge;
    paintChallenge(c, { animate:false });
    switch(active.phase){
      case "revealed":     showRevealedState(c); break;
      case "timer":        showTimerState(); break;
      case "research":     showResearchState(); break;
      case "researchDone": showResearchDoneState(); break;
      case "talk":         showTalkState(); break;
      case "finished":     showFinishedState(); break;
    }
    announce("Tu reto en marcha. " + c.text);
  }

  // Bifurca según el tipo de reto: los de cronómetro arrancan el temporizador
  // en pantalla; los de Experiencia se apuntan en "Retos pendientes".
  // Cada paso del reto se apunta también en el servidor (con reintentos).
  function syncDraw(fn, extra){
    const active = data.activeChallenge;
    const drawId = extra && extra.drawId ? extra.drawId : (active && active.drawId);
    if(!cloudOn || !drawId) return;
    const args = Object.assign({ p_draw_id: drawId }, extra && extra.args);
    Cloud.enqueue(fn, args).catch(() => {});
  }

  function handleStart(challenge){
    if(challenge.durationType !== "pending") syncDraw("start_draw");
    if(challenge.durationType === "pending"){
      savePendingChallenge(challenge);
    }else if(challenge.durationType === "research"){
      startResearchPhase(challenge);
    }else{
      beginTimer(challenge);
    }
  }

  function savePendingChallenge(challenge){
    const entry = {
      activeId: "pending-" + Date.now() + "-" + Math.floor(Math.random()*1000),
      challengeId: challenge.id,
      text: challenge.text,
      category: challenge.category,
      points: challenge.points,
      savedAt: Date.now(),
      drawId: data.activeChallenge ? data.activeChallenge.drawId || null : null
    };
    syncDraw("save_pending");
    // Nunca dos veces el mismo reto en pendientes (en modo pruebas puede volver a salir).
    data.pendingChallenges = data.pendingChallenges.filter(p => p.challengeId !== challenge.id);
    data.pendingChallenges.push(entry);
    data.activeChallenge = null; // queda guardado en pendientes: el compromiso sigue ahí
    saveData();
    updatePendingBadge();

    setHeadline("Apuntado.");
    $("#challenge-duration-label").textContent = "";
    showMicroCopy("Está guardado en tus retos pendientes.");
    setActionButton("VOLVER AL INICIO", () => goTo("home"));
  }

  /* ---------- Cuenta atrás basada en la hora real ----------
     Antes contaba "segundo a segundo" y se congelaba al bloquear el móvil.
     Ahora guarda la hora de fin: aunque la app esté en segundo plano o se
     cierre, al volver el reloj marca el tiempo que de verdad queda. */
  const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * 90;

  function paintTimer(remaining, total, { instant }){
    const arc = $("#timer-arc");
    const ratio = total > 0 ? remaining / total : 0;
    if(instant){
      arc.style.transition = "none";
      arc.style.strokeDashoffset = (TIMER_RING_CIRCUMFERENCE * (1 - ratio)).toFixed(2);
      void arc.getBoundingClientRect();
      arc.style.transition = "";
    }else{
      arc.style.strokeDashoffset = (TIMER_RING_CIRCUMFERENCE * (1 - ratio)).toFixed(2);
    }
    $("#timer-value").textContent = formatTimer(remaining);
    const urgent = remaining <= 10 && remaining > 0;
    // Como en la versión original: el fondo respira con el cronómetro normal y
    // al hablar; investigando solo se acelera en los últimos 10 segundos.
    const phase = data.activeChallenge ? data.activeChallenge.phase : null;
    const breathe = !urgent && remaining > 0 && phase !== "research";
    $("#timer-value").parentElement.classList.toggle("timer-urgent", urgent);
    document.body.classList.toggle("breathing", breathe);
    document.body.classList.toggle("breathing-fast", urgent);
  }

  function showTimerUI(){
    $("#challenge-duration-label").textContent = "";
    $("#timer-display").classList.remove("hidden");
    state.lastRenderedSecond = null;
    tickCountdown(true);
    state.timerHandle = setInterval(() => tickCountdown(false), 250);
  }

  function tickCountdown(first){
    const active = data.activeChallenge;
    if(!active || !active.endsAt){ stopCountdown(); return; }
    const remaining = Core.remainingSeconds(active.endsAt);
    if(remaining !== state.lastRenderedSecond){
      const previous = state.lastRenderedSecond;
      state.lastRenderedSecond = remaining;
      paintTimer(remaining, active.total, { instant: !!first });
      if(!first && previous !== null && remaining > 0 && remaining <= 5) Sound.countdown(remaining);
    }
    if(remaining <= 0){
      stopCountdown();
      if(!first){
        Sound.timeUp();
        vibrate([40, 60, 40]);
      }
      if(active.phase === "research") finishResearchPhase();
      else finishTimer();
    }
  }

  function stopCountdown(){
    clearInterval(state.timerHandle);
    state.timerHandle = null;
    document.body.classList.remove("breathing", "breathing-fast");
  }

  function beginTimer(challenge){
    const active = data.activeChallenge;
    if(!active) return;
    Core.startTimedPhase(active, "timer", challenge.duration);
    active.microcopy = MICROCOPY[Math.floor(Math.random()*MICROCOPY.length)];
    saveData();
    showTimerState();
  }

  function showTimerState(){
    const active = data.activeChallenge;
    setHeadline(categoryLabel(active.challenge.category));
    showMicroCopy(active.microcopy || MICROCOPY[0]);
    setActionButton("TERMINAR AHORA", () => finishTimer());
    showTimerUI();
  }

  // ---- "Conocimiento": fase 1, investigar (10 min) ----
  function startResearchPhase(challenge){
    const active = data.activeChallenge;
    if(!active) return;
    Core.startTimedPhase(active, "research", challenge.researchDuration);
    saveData();
    showResearchState();
  }

  function showResearchState(){
    setHeadline("Investigando.");
    showMicroCopy("Investígalo a fondo. Luego tendrás que hablar de ello.");
    setActionButton("YA SÉ SUFICIENTE", finishResearchPhase);
    showTimerUI();
  }

  // ---- "Conocimiento": investigación terminada, toca hablar ----
  function finishResearchPhase(){
    stopCountdown();
    const active = data.activeChallenge;
    if(!active) return;
    Core.setPhase(active, "researchDone");
    saveData();
    showResearchDoneState();
  }

  function showResearchDoneState(){
    setHeadline("Tiempo de investigar.");
    $("#timer-display").classList.remove("hidden");
    paintTimer(0, 1, { instant:true });
    showMicroCopy("Cuenta lo que has aprendido.");
    setActionButton("HABLAR", beginTalkPhase);
  }

  // ---- "Conocimiento": fase 2, hablar de lo aprendido (1 min) ----
  function beginTalkPhase(){
    const active = data.activeChallenge;
    if(!active) return;
    Core.startTimedPhase(active, "talk", active.challenge.talkDuration);
    saveData();
    showTalkState();
  }

  function showTalkState(){
    setHeadline("Hablando.");
    showMicroCopy("Habla de lo que has aprendido.");
    setActionButton("TERMINAR AHORA", () => finishTimer());
    showTimerUI();
  }

  function finishTimer(){
    stopCountdown();
    const active = data.activeChallenge;
    if(!active) return;
    Core.setPhase(active, "finished");
    saveData();
    showFinishedState();
  }

  function showFinishedState(){
    setHeadline("Tiempo.");
    $("#timer-display").classList.remove("hidden");
    paintTimer(0, 1, { instant:true });
    showMicroCopy(null);
    setActionButton("LO HE HECHO", () => completeChallenge());
  }

  function completeChallenge(){
    const active = data.activeChallenge;
    if(!active) return;
    const challenge = active.challenge;
    Sound.complete();
    vibrate([15, 40, 15, 40, 25]);

    Core.applyCompletion(data, {
      id: challenge.id, text: challenge.text, category: challenge.category, points: challenge.points
    });
    Core.registerRecent(data, challenge.id);
    syncDraw("complete_draw");
    state.lastCompleted = { challenge, drawId: active.drawId || null, weeklyId: active.weeklyId || null };
    if(active.weeklyId && active.drawId) markWeeklyDone(active.weeklyId, active.drawId);
    data.activeChallenge = null;
    saveData();

    setHeadline("Reto completado.");
    $("#challenge-text").classList.remove("len-md", "len-lg");
    $("#challenge-text").textContent = "+" + challenge.points + " XP";
    $("#challenge-meta").textContent = categoryLabel(challenge.category);
    $("#challenge-duration-label").textContent = "";
    announce("Reto completado. Más " + challenge.points + " XP.");

    setActionButton("VOLVER AL INICIO", () => goTo("home"));

    [$("#reveal-headline"), $("#challenge-card")].forEach(el => retrigger(el, "reveal-enter"));
  }

  /* ---------- RETOS PENDIENTES (Experiencia, sin plazo) ---------- */
  function updatePendingBadge(){
    const badge = $("#pending-badge");
    const count = data.pendingChallenges.length;
    const nav = $("#pending-nav");
    if(count > 0){
      badge.textContent = String(count);
      badge.classList.remove("hidden");
      badge.classList.add("flex");
      nav.setAttribute("aria-label", "Retos pendientes (" + count + ")");
    }else{
      badge.classList.add("hidden");
      badge.classList.remove("flex");
      nav.setAttribute("aria-label", "Retos pendientes");
    }
  }

  function formatSavedAt(savedAt){
    const days = Math.floor((Date.now() - savedAt) / (24*60*60*1000));
    if(days <= 0) return "Apuntado hoy";
    if(days === 1) return "Apuntado ayer";
    return "Apuntado hace " + days + " días";
  }

  function renderPendingChallenges(){
    const list = $("#pending-list");
    list.innerHTML = "";
    if(data.pendingChallenges.length === 0){
      $("#pending-empty").classList.remove("hidden");
      return;
    }
    $("#pending-empty").classList.add("hidden");

    const sorted = [...data.pendingChallenges].sort((a,b) => a.savedAt - b.savedAt);
    sorted.forEach(entry => {
      const row = document.createElement("div");
      row.className = "card-dark rounded-2xl p-4 flex flex-col gap-3";
      row.innerHTML = `
        <div>
          <p class="font-num text-[11px] uppercase tracking-wide opacity-60 mb-1">${escapeHtml(categoryLabel(entry.category))}</p>
          <p class="font-display font-extrabold text-base leading-snug">${escapeHtml(entry.text)}</p>
        </div>
        <div class="flex items-center justify-between gap-3">
          <p class="font-num text-xs uppercase tracking-wide opacity-70">${escapeHtml(formatSavedAt(entry.savedAt))}</p>
          <button class="btn-invert rounded-full px-5 py-2 font-display font-black text-xs tight-sm uppercase shrink-0" data-complete-pending="${escapeHtml(entry.activeId)}">Lo he hecho</button>
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll("[data-complete-pending]").forEach(btn => {
      btn.addEventListener("click", () => completePendingChallenge(btn.dataset.completePending));
    });
  }

  function completePendingChallenge(activeId){
    const entry = data.pendingChallenges.find(a => a.activeId === activeId);
    if(!entry) return;
    Sound.complete();
    vibrate([15, 40, 15, 40, 25]);

    Core.applyCompletion(data, { id: entry.challengeId, text: entry.text, category: entry.category, points: entry.points });
    if(entry.drawId) syncDraw("complete_draw", { drawId: entry.drawId });
    data.pendingChallenges = data.pendingChallenges.filter(a => a.activeId !== activeId);
    saveData();
    updatePendingBadge();
    renderPendingChallenges();
    showToast("Reto completado. +" + entry.points + " XP");
  }

  /* ---------- PROGRESO ---------- */
  function renderProgress(){
    $("#stat-total").textContent = Core.totalCompleted(data);
    $("#stat-xp").textContent = data.xp;
    $("#stat-streak").textContent = Core.effectiveStreak(data);

    const breakdown = $("#category-breakdown");
    breakdown.innerHTML = "";
    const max = Math.max(1, ...Object.values(data.stats));
    CATEGORIES.filter(c => c.id !== "todos").forEach(cat => {
      const count = data.stats[cat.id] || 0;
      const pct = Math.round((count / max) * 100);
      const row = document.createElement("div");
      row.innerHTML = `
        <div class="flex items-center justify-between mb-1.5">
          <span class="font-display font-bold text-xs uppercase tracking-wide opacity-85">${escapeHtml(cat.label)}</span>
          <span class="font-num font-bold text-xs">${count}</span>
        </div>
        <div class="progress-bar-track h-1.5 rounded-full overflow-hidden" role="presentation">
          <div class="progress-bar-fill h-full rounded-full" style="width:${pct}%"></div>
        </div>`;
      breakdown.appendChild(row);
    });

    const historyList = $("#history-list");
    historyList.innerHTML = "";
    if(data.completedLog.length === 0){
      historyList.innerHTML = `<p class="font-medium text-sm opacity-60 py-2">Todavía no has completado ningún reto.</p>`;
    }else{
      data.completedLog.slice(0,12).forEach(item => {
        const row = document.createElement("div");
        row.className = "flex items-center gap-3 py-2 border-b";
        row.style.borderColor = "var(--line-soft)";
        row.innerHTML = `
          <span class="font-display font-black" aria-hidden="true">✓</span>
          <span class="font-medium text-sm flex-1 truncate">${escapeHtml(item.text)}</span>
          <span class="font-num text-[11px] opacity-60 shrink-0">+${Number(item.xp) || 0}</span>`;
        historyList.appendChild(row);
      });
    }
  }

  /* ---------- MIS RETOS ---------- */
  function populateCategorySelect(){
    const sel = $("#input-category");
    sel.innerHTML = "";
    // "Conocimiento" tiene su propio mecanismo de dos fases (investigar + hablar)
    // que no aplica a los retos que tú mismo escribas, así que no aparece aquí.
    CATEGORIES.filter(c => Core.CUSTOM_CATEGORIES.includes(c.id)).forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.label;
      sel.appendChild(opt);
    });
  }
  populateCategorySelect();

  $("#save-challenge-btn").addEventListener("click", () => {
    const text = $("#input-text").value.trim();
    if(text.length < 6){
      showToast("Escribe un reto un poco más concreto.");
      $("#input-text").focus();
      return;
    }
    const category = $("#input-category").value;
    const duration = parseInt($("#input-duration").value, 10);

    if(state.editingChallengeId){
      const idx = data.customChallenges.findIndex(c => c.id === state.editingChallengeId);
      if(idx !== -1){
        data.customChallenges[idx] = mk(state.editingChallengeId, text, category, duration, CUSTOM_CHALLENGE_POINTS);
      }
      state.editingChallengeId = null;
      showToast("Reto actualizado.");
    }else{
      const id = "custom-" + Date.now();
      data.customChallenges.push(mk(id, text, category, duration, CUSTOM_CHALLENGE_POINTS));
      showToast("Reto guardado.");
    }
    saveData();
    resetForm();
    renderMyChallenges();
  });

  $("#cancel-edit-btn").addEventListener("click", resetForm);

  function resetForm(){
    state.editingChallengeId = null;
    $("#input-text").value = "";
    $("#input-category").value = "espontanea";
    $("#input-duration").value = "300";
    $("#form-title").textContent = "Describe tu reto";
    $("#save-challenge-btn").textContent = "Guardar reto";
    $("#cancel-edit-btn").classList.add("hidden");
  }

  function editCustomChallenge(id){
    const c = data.customChallenges.find(c => c.id === id);
    if(!c) return;
    state.editingChallengeId = id;
    $("#input-text").value = c.text;
    $("#input-category").value = c.category;
    $("#input-duration").value = String(c.duration);
    $("#form-title").textContent = "Editar reto";
    $("#save-challenge-btn").textContent = "Guardar cambios";
    $("#cancel-edit-btn").classList.remove("hidden");
    const scroller = $("#screen-mychallenges .overflow-y-auto");
    if(scroller) scroller.scrollTo({ top:0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    $("#input-text").focus({ preventScroll:true });
  }

  function deleteCustomChallenge(id){
    data.customChallenges = data.customChallenges.filter(c => c.id !== id);
    if(state.editingChallengeId === id) resetForm();
    saveData();
    renderMyChallenges();
    showToast("Reto eliminado.");
  }

  function toggleDefaultChallenge(id){
    const idx = data.disabledDefaultIds.indexOf(id);
    if(idx === -1) data.disabledDefaultIds.push(id);
    else data.disabledDefaultIds.splice(idx,1);
    saveData();
    renderMyChallenges();
    const again = document.querySelector('[data-toggle="' + id + '"]');
    if(again) again.focus({ preventScroll:true });
  }

  $("#restore-defaults-btn").addEventListener("click", () => {
    data.disabledDefaultIds = [];
    saveData();
    renderMyChallenges();
    showToast("Retos predeterminados restaurados.");
  });

  function renderMyChallenges(){
    const customList = $("#custom-list");
    customList.innerHTML = "";
    if(data.customChallenges.length === 0){
      $("#custom-empty").classList.remove("hidden");
    }else{
      $("#custom-empty").classList.add("hidden");
      data.customChallenges.forEach(c => {
        const row = document.createElement("div");
        row.className = "card-dark rounded-2xl p-4 flex items-start gap-3";
        row.innerHTML = `
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm leading-snug">${escapeHtml(c.text)}</p>
            <p class="font-num text-[11px] opacity-60 mt-1 uppercase">${escapeHtml(categoryLabel(c.category))} · ${escapeHtml(formatDuration(c))}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button class="btn-ghost rounded-full px-4 py-2 text-xs font-bold" data-edit="${escapeHtml(c.id)}">Editar</button>
            <button class="btn-ghost rounded-full px-4 py-2 text-xs font-bold" data-delete="${escapeHtml(c.id)}">Eliminar</button>
          </div>`;
        customList.appendChild(row);
      });
      customList.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editCustomChallenge(b.dataset.edit)));
      customList.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => deleteCustomChallenge(b.dataset.delete)));
    }

    const defaultList = $("#default-list");
    defaultList.innerHTML = "";
    Core.getCatalog().forEach(c => {
      const disabled = data.disabledDefaultIds.includes(c.id);
      const row = document.createElement("div");
      row.className = "flex items-center gap-3 py-2.5 border-b";
      row.style.borderColor = "var(--line-soft)";
      row.style.opacity = disabled ? "0.45" : "1";
      row.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="font-medium text-xs leading-snug truncate">${escapeHtml(c.text)}</p>
          <p class="font-num text-[10px] opacity-60 mt-0.5 uppercase">${escapeHtml(categoryLabel(c.category))}${disabled ? " · fuera del sorteo" : ""}</p>
        </div>
        <button class="btn-ghost rounded-full px-4 py-1.5 text-[11px] font-bold shrink-0" data-toggle="${escapeHtml(c.id)}" aria-pressed="${disabled ? "false" : "true"}" aria-label="${disabled ? "Activar" : "Desactivar"}: ${escapeHtml(c.text)}">${disabled ? "Activar" : "Desactivar"}</button>`;
      defaultList.appendChild(row);
    });
    defaultList.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => toggleDefaultChallenge(b.dataset.toggle)));
  }

  /* =========================================================
     9. AJUSTES
  ========================================================= */
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function isStandalone(){
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  let deferredInstallPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if(state.screen === "settings") renderInstallRow();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if(state.screen === "settings") renderInstallRow();
    showToast("INERGO instalada.");
  });

  function renderInstallRow(){
    const hint = $("#install-hint");
    const btn = $("#install-btn");
    btn.classList.add("hidden");
    btn.onclick = null;
    if(isStandalone()){
      hint.textContent = "Ya la estás usando como app.";
    }else if(deferredInstallPrompt){
      hint.textContent = "Icono propio, pantalla completa y funciona sin conexión.";
      btn.textContent = "Instalar";
      btn.classList.remove("hidden");
      btn.onclick = async () => {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        try{
          promptEvent.prompt();
          await promptEvent.userChoice;
        }catch(e){}
        renderInstallRow();
      };
    }else if(isIOS){
      hint.textContent = "En iPhone se instala desde Safari.";
      btn.textContent = "Cómo";
      btn.classList.remove("hidden");
      btn.onclick = showIOSInstallSheet;
    }else{
      hint.textContent = "Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».";
    }
  }

  function showIOSInstallSheet(){
    openSheet({
      title: "Instalar en iPhone",
      html: `
        <ol class="sheet-steps">
          <li><span>Abre INERGO en <strong>Safari</strong>.</span></li>
          <li><span>Toca el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).</span></li>
          <li><span>Elige <strong>Añadir a pantalla de inicio</strong> y confirma.</span></li>
        </ol>
        <p class="mt-5 text-xs opacity-75">Ojo: la app instalada no comparte el progreso con Safari. Si ya tienes progreso aquí, usa «Exportar copia» antes e «Importar copia» dentro de la app.</p>`,
      actions: [{ label:"Entendido", primary:true }]
    });
  }

  function bindToggle(input, key, onChange){
    input.checked = !!data[key];
    input.addEventListener("change", () => {
      data[key] = input.checked;
      saveData();
      if(onChange) onChange(input.checked);
    });
  }

  function setupSettings(){
    bindToggle($("#sound-toggle"), "soundOn", (on) => { if(on){ getAudioCtx(); Sound.complete(); } });
    const haptics = $("#haptics-toggle");
    bindToggle(haptics, "hapticsOn", (on) => { if(on) vibrate(20); });
    if(!canVibrate){
      haptics.disabled = true;
      $("#haptics-hint").textContent = "Este dispositivo no permite vibración desde el navegador.";
    }
    $("#version-label").textContent = "INERGO v" + APP_VERSION + " · por @alfonsog0nzalez";
    $("#testmode-toggle").addEventListener("change", (e) => setTestMode(e.target.checked));
    let versionTaps = 0, versionTapTimer = null;
    $("#version-label").addEventListener("click", () => {
      versionTaps++;
      clearTimeout(versionTapTimer);
      versionTapTimer = setTimeout(() => { versionTaps = 0; }, 2500);
      if(versionTaps >= 5){
        versionTaps = 0;
        if(!testAllowed){ adminDoor = true; renderTestModeUI(); showToast("Administración desbloqueada en Ajustes."); }
        else setTestMode(!data.testMode);
      }
    });
    $("#replay-onboarding-btn").addEventListener("click", () => openOnboarding());
    $("#export-btn").addEventListener("click", exportData);
    $("#import-btn").addEventListener("click", () => $("#import-input").click());
    $("#import-input").addEventListener("change", handleImportFile);
    $("#reset-btn").addEventListener("click", confirmReset);
  }

  /* ---------- BARCO DE LA SEMANA (v2.3) ----------
     Un reto fijo para toda la comunidad durante unos días. Te subes, lo
     haces, pegas el enlace de tu vídeo y sales en la tripulación. */
  const WEEKLY_DONE_KEY = "inergo_weekly_done_v1";
  const barco = { current: null, loadedAt: 0 };
  function readWeeklyDone(){
    try{ const m = JSON.parse(localStorage.getItem(WEEKLY_DONE_KEY)); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }
    catch(e){ return {}; }
  }
  function markWeeklyDone(weeklyId, drawId){
    const m = readWeeklyDone(); m[weeklyId] = drawId;
    try{ localStorage.setItem(WEEKLY_DONE_KEY, JSON.stringify(m)); }catch(e){}
  }
  async function loadBarco(force){
    if(!cloudOn || navigator.onLine === false) return null;
    if(!force && barco.loadedAt && Date.now() - barco.loadedAt < 60000) return barco.current;
    try{ barco.current = await Cloud.currentWeekly(); barco.loadedAt = Date.now(); }catch(e){}
    return barco.current;
  }
  function formatEnds(iso){
    try{ return new Date(iso).toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" }); }
    catch(e){ return ""; }
  }
  async function renderBarcoPill(){
    const pill = $("#barco-pill");
    const w = await loadBarco();
    if(!w){ pill.classList.add("hidden"); return; }
    pill.textContent = "Barco" + (w.crew ? " · " + w.crew + " a bordo" : " de la semana");
    pill.setAttribute("aria-label", "Barco de la semana" + (w.crew ? ", " + w.crew + " a bordo" : ""));
    pill.classList.remove("hidden");
  }

  async function renderBarco(){
    showBlock($("#barco-main"), false);
    showBlock($("#barco-none"), false);
    $("#barco-loading").classList.remove("hidden");
    const w = await loadBarco(true);
    $("#barco-loading").classList.add("hidden");
    if(!w){ showBlock($("#barco-none"), true); return; }
    showBlock($("#barco-main"), true);
    $("#barco-title").textContent = w.title;
    $("#barco-text").textContent = w.challenge_text;
    $("#barco-meta").textContent = categoryLabel(w.category) + " · zarpa el " + formatEnds(w.ends_at);
    $("#barco-share").onclick = () => shareCard({ text: w.challenge_text, kind: "barco" });

    const btn = $("#barco-join"), hint = $("#barco-hint");
    const doneDraw = readWeeklyDone()[w.id];
    const active = data.activeChallenge;
    btn.disabled = false;
    if(doneDraw){
      btn.textContent = "Añadir mi vídeo";
      hint.textContent = "Ya lo cumpliste. Pega el enlace de tu vídeo para salir en la tripulación.";
      btn.onclick = () => openEvidenceSheet({ drawId: doneDraw, weeklyId: w.id });
    }else if(active && active.weeklyId === w.id){
      btn.textContent = "Ir a mi reto";
      hint.textContent = "Ya estás a bordo. No hay vuelta atrás.";
      btn.onclick = () => resumeActive();
    }else if(active){
      btn.textContent = "Subirme al Barco";
      hint.textContent = "Primero termina o abandona el reto que tienes en marcha.";
      btn.onclick = () => showToast("Primero termina o abandona el reto que tienes en marcha.");
    }else{
      btn.textContent = "Subirme al Barco";
      hint.textContent = "Al subirte, este pasa a ser tu reto. No hay vuelta atrás.";
      btn.onclick = () => joinBarco(w);
    }
    renderCrew(w);
  }

  async function renderCrew(w){
    const list = $("#barco-crew");
    let rows = [];
    try{ rows = await Cloud.weeklyCrew(w.id) || []; }catch(e){ rows = []; }
    list.innerHTML = "";
    $("#barco-count").textContent = String(rows.length);
    $("#barco-crew-empty").classList.toggle("hidden", rows.length > 0);
    rows.forEach(r => {
      const url = Core.cleanEvidenceUrl(r.evidence_url);
      const row = document.createElement("div");
      row.className = "set-row";
      row.innerHTML = `<p class="set-row-label">@${escapeHtml(r.username || "")}</p>` +
        (url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" class="font-num text-[11px] uppercase tracking-wide underline opacity-80 py-2 shrink-0">Ver vídeo</a>` : "");
      list.appendChild(row);
    });
  }

  async function joinBarco(w){
    const btn = $("#barco-join");
    setBusy(btn, true);
    try{
      const row = await Cloud.rpc("join_weekly", { p_weekly_id: w.id });
      const r = Core.challengeFromDraw(Array.isArray(row) ? row[0] : row);
      if(!r) throw new Error("No se pudo cargar el reto. Prueba otra vez.");
      data.activeChallenge = Core.createActive(r.challenge, undefined, r.drawId, r.weeklyId || w.id);
      saveData();
      setBusy(btn, false);
      Sound.clickPlay();
      vibrate(15);
      goTo("play");
      startSpin(r.challenge);
    }catch(e){
      setBusy(btn, false);
      showToast(e.message);
    }
  }

  function openEvidenceSheet({ drawId, weeklyId }){
    const registered = Cloud.isRegistered();
    const shareRow = weeklyId
      ? `<label class="flex items-start gap-3 text-sm leading-snug mt-4">
           <input id="ev-share" type="checkbox" class="mt-1" ${registered ? "checked" : "disabled"}>
           <span>Salir en la tripulación del Barco con mi usuario.${registered ? "" : " Necesitas cuenta y usuario: créalos en Ajustes."}</span>
         </label>`
      : "";
    openSheet({
      title: "Añade tu vídeo",
      html: `<p>Pega el enlace de tu publicación en TikTok, Instagram o YouTube.</p>
        <label for="ev-url" class="sr-only">Enlace del vídeo</label>
        <input id="ev-url" type="url" inputmode="url" autocapitalize="off" spellcheck="false" class="w-full rounded-xl px-4 py-3 font-medium text-base mt-4" placeholder="https://www.tiktok.com/@…">
        ${shareRow}`,
      actions: [
        { label:"Guardar", primary:true, onClick: () => saveEvidence(drawId) },
        { label:"Ahora no" }
      ]
    });
    setTimeout(() => { const i = $("#ev-url"); if(i) i.focus({ preventScroll:true }); }, 80);
  }

  async function saveEvidence(drawId){
    const url = Core.cleanEvidenceUrl(($("#ev-url") || {}).value);
    const shareEl = $("#ev-share");
    const share = !!(shareEl && shareEl.checked && !shareEl.disabled);
    if(!url){ showToast("El enlace tiene que ser de TikTok, Instagram o YouTube (https)."); return; }
    try{
      await Cloud.flushOutbox().catch(() => {}); // por si «completar» aún no había llegado
      await Cloud.rpc("add_evidence", { p_draw_id: drawId, p_evidence_url: url, p_share: share });
      showToast(share ? "A bordo: ya sales en la tripulación." : "Vídeo guardado.");
      barco.loadedAt = 0;
      if(state.screen === "barco") renderBarco();
    }catch(e){
      showToast(e.message);
    }
  }

  /* ---------- Tarjeta para historias (1080×1920) ----------
     Se dibuja en el móvil: con el menú de compartir del sistema si lo hay,
     y si no, se descarga la imagen. */
  function wrapLines(g, text, maxWidth){
    const words = text.split(/\s+/), lines = [];
    let line = "";
    words.forEach(w => {
      const test = line ? line + " " + w : w;
      if(g.measureText(test).width > maxWidth && line){ lines.push(line); line = w; }
      else line = test;
    });
    if(line) lines.push(line);
    return lines;
  }
  async function shareCard({ text, kind }){
    const W = 1080, H = 1920, X = 96, maxW = W - 2 * X;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    try{ await Promise.all([document.fonts.load('800 96px Manrope'), document.fonts.load('600 40px Inter')]); }catch(e){}
    g.fillStyle = "#FF6347"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#FFFFFF"; g.textBaseline = "top";

    g.font = '800 92px Manrope, system-ui, sans-serif';
    g.fillText("INERGO", X, 150);
    const kicker = kind === "hecho" ? "LO HE HECHO:" : kind === "barco" ? "BARCO DE LA SEMANA:" : "ME HA TOCADO:";
    g.globalAlpha = 0.85; g.font = '600 42px Inter, system-ui, sans-serif';
    g.fillText(kicker, X, 470); g.globalAlpha = 1;

    let size = 104, lines;
    do{
      g.font = '800 ' + size + 'px Manrope, system-ui, sans-serif';
      lines = wrapLines(g, String(text || "").toUpperCase(), maxW);
      size -= 6;
    }while(lines.length * (size + 6) * 1.06 > 900 && size > 48);
    const lh = (size + 6) * 1.06;
    lines.forEach((l, i) => g.fillText(l, X, 550 + i * lh));

    g.font = '800 58px Manrope, system-ui, sans-serif';
    g.fillText(kind === "hecho" ? "Hecho. Sin vuelta atrás." : "No hay vuelta atrás.", X, H - 400);
    g.globalAlpha = 0.85; g.font = '600 38px Inter, system-ui, sans-serif';
    g.fillText("inergo.vercel.app · @alfonsog0nzalez", X, H - 290); g.globalAlpha = 1;

    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if(!blob){ showToast("No se pudo crear la imagen."); return; }
    const file = new File([blob], "inergo-reto.png", { type:"image/png" });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      try{ await navigator.share({ files:[file], text:"INERGO · https://inergo.vercel.app" }); }catch(e){}
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inergo-reto.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast("Imagen descargada: súbela a tus historias.");
  }

  /* ---------- CUENTA (v2.2) ---------- */
  const LEGACY_FLAG = "inergo_legacy_imported_v1";
  function renderAccount(){
    $("#account-section").classList.toggle("hidden", !cloudOn);
    if(!cloudOn) return;
    const registered = Cloud.isRegistered();
    $("#account-guest").classList.toggle("hidden", registered);
    $("#account-user").classList.toggle("hidden", !registered);
    if(registered){
      $("#acc-user-email").textContent = Cloud.getSession().email;
      Cloud.getProfile().then(p => { if(p && p.username) $("#acc-username").value = p.username; }).catch(() => {});
    }
  }

  // Sube una sola vez el progreso que ya estaba en este móvil.
  async function importLegacyOnce(){
    let done = null;
    try{ done = localStorage.getItem(LEGACY_FLAG); }catch(e){}
    if(done || (data.xp === 0 && Core.totalCompleted(data) === 0)) return;
    try{
      await Cloud.rpc("import_legacy_progress", { p_xp: data.xp, p_completed: Core.totalCompleted(data), p_stats: data.stats });
    }catch(e){
      if(!(e.status && e.status < 500)) return; // red: se intenta otra vez al próximo inicio de sesión
    }
    try{ localStorage.setItem(LEGACY_FLAG, "1"); }catch(e){}
  }

  async function accountAction(kind){
    const btn = kind === "signup" ? $("#acc-signup") : $("#acc-signin");
    const email = $("#acc-email").value, pw = $("#acc-password").value;
    if(kind === "signup" && !$("#acc-adult").checked){ showToast("Marca que tienes 18 años o más para crear la cuenta."); return; }
    setBusy(btn, true);
    try{
      if(kind === "signup"){
        await Cloud.signUp(email, pw);
        await Cloud.rpc("confirm_adult", {}).catch(() => Cloud.enqueue("confirm_adult", {}));
        showToast("Cuenta creada.");
      }else{
        await Cloud.signIn(email, pw);
        showToast("Sesión iniciada.");
      }
      await importLegacyOnce();
      $("#acc-password").value = "";
      refreshAdminRights();
    }catch(e){
      showToast(e.message);
    }
    setBusy(btn, false);
    renderAccount();
  }

  function setupAccount(){
    $("#account-guest").addEventListener("submit", (e) => { e.preventDefault(); accountAction("signup"); });
    $("#acc-signin").addEventListener("click", () => accountAction("signin"));
    $("#acc-username-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const u = Core.cleanUsername($("#acc-username").value);
      if(!u){ showToast("Usuario: 3-24 letras minúsculas, números, punto o guion bajo."); return; }
      try{
        await Cloud.updateProfile({ username: u });
        $("#acc-username").value = u;
        showToast("Usuario guardado: @" + u);
      }catch(err){ showToast(err.message); }
    });
    $("#acc-signout").addEventListener("click", async () => {
      await Cloud.signOut();
      testAllowed = false;
      admin.isAdmin = null;
      renderTestModeUI();
      renderAccount();
      showToast("Sesión cerrada.");
    });
  }

  function renderSettings(){
    renderAccount();
    $("#sound-toggle").checked = !!data.soundOn;
    $("#haptics-toggle").checked = !!data.hapticsOn && canVibrate;
    renderInstallRow();
    renderTestModeUI();
  }

  async function exportData(){
    const backup = JSON.stringify(Core.buildBackup(data), null, 2);
    const filename = "inergo-copia-" + Core.localDateKey(new Date()) + ".json";
    try{
      const file = new File([backup], filename, { type:"application/json" });
      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ files:[file], title:"Copia de INERGO" });
        return;
      }
    }catch(e){
      if(e && e.name === "AbortError") return;
    }
    const url = URL.createObjectURL(new Blob([backup], { type:"application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("Copia descargada.");
  }

  function handleImportFile(e){
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = "";
    if(!file) return;
    if(file.size > 2 * 1024 * 1024){ showToast("Ese archivo es demasiado grande."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try{ imported = Core.parseBackup(String(reader.result)); }
      catch(err){ showToast(err.message); return; }
      const now = Core.totalCompleted(data);
      const incoming = Core.totalCompleted(imported);
      openSheet({
        title: "¿Importar copia?",
        html: `<p>Tu progreso actual en este dispositivo (<strong>${now}</strong> retos, <strong>${data.xp}</strong> XP) se sustituirá por el de la copia (<strong>${incoming}</strong> retos, <strong>${imported.xp}</strong> XP).</p>`,
        actions: [
          { label:"Importar", primary:true, onClick: () => applyImport(imported) },
          { label:"Cancelar" }
        ]
      });
    };
    reader.onerror = () => showToast("No se pudo leer el archivo.");
    reader.readAsText(file);
  }

  function applyImport(imported){
    // Un reto ya revelado aquí no se puede esquivar importando una copia.
    if(data.activeChallenge) imported.activeChallenge = data.activeChallenge;
    imported.onboardingDone = true;
    data = imported;
    saveData();
    applyMirror();
    updatePendingBadge();
    renderSettings();
    renderTestModeUI();
    showToast("Copia importada.");
  }

  function confirmReset(){
    openSheet({
      title: "¿Borrar todo?",
      html: `<p>Se eliminarán de este dispositivo tu XP, racha, historial, retos personalizados, pendientes y ajustes. No se puede deshacer.</p>`,
      actions: [
        { label:"Borrar todo", danger:true, onClick: () => {
          data = Core.defaultData();
          data.onboardingDone = true;
          saveData();
          applyMirror();
          updatePendingBadge();
          renderSettings();
          showToast("Datos borrados.");
        }},
        { label:"Cancelar" }
      ]
    });
  }

  /* ---------- Diálogos: lo que queda detrás no se puede enfocar ---------- */
  function setBackgroundInert(dialogEl, on){
    Array.from($(".app-shell").children).forEach(el => {
      if(el === dialogEl || el.id === "reveal-flash" || el.id === "reveal-shockwave") return;
      if(on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  /* ---------- Hoja inferior ---------- */
  let sheetReturnFocus = null;
  function openSheet({ title, html, actions }){
    const sheet = $("#sheet");
    $("#sheet-title").textContent = title;
    $("#sheet-body").innerHTML = html;
    const wrap = $("#sheet-actions");
    wrap.innerHTML = "";
    (actions || []).forEach(a => {
      const b = document.createElement("button");
      b.className = a.danger
        ? "w-full rounded-2xl py-4 font-display font-black text-base tight-sm uppercase"
        : a.primary
          ? "btn-invert w-full rounded-2xl py-4 font-display font-black text-base tight-sm uppercase"
          : "btn-ghost w-full rounded-2xl py-3.5 font-display font-bold text-sm uppercase";
      if(a.danger){ b.style.background = "var(--bg)"; b.style.color = "var(--paper)"; }
      if(a.primary) b.style.color = "var(--ink)";
      b.textContent = a.label;
      b.addEventListener("click", () => { closeSheet(); if(a.onClick) a.onClick(); });
      wrap.appendChild(b);
    });
    sheetReturnFocus = document.activeElement;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    setBackgroundInert(sheet, true);
    const first = wrap.querySelector("button");
    if(first) setTimeout(() => first.focus({ preventScroll:true }), 50);
  }
  function closeSheet(){
    const sheet = $("#sheet");
    if(!sheet.classList.contains("open")) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    setBackgroundInert(sheet, $("#onboarding").classList.contains("open") ? true : false);
    if(sheetReturnFocus && sheetReturnFocus.focus) sheetReturnFocus.focus({ preventScroll:true });
  }
  $("#sheet").addEventListener("click", (e) => { if(e.target.id === "sheet") closeSheet(); });

  /* =========================================================
     10. INTRODUCCIÓN (solo la primera vez; se puede saltar)
  ========================================================= */
  let obStep = 0;
  function renderOnboardingStep(){
    $all(".ob-step").forEach((el, i) => el.classList.toggle("active", i === obStep));
    $all(".ob-dot").forEach((el, i) => el.classList.toggle("active", i === obStep));
    $("#ob-next").textContent = obStep === 2 ? "Empezar" : "Siguiente";
    const title = $all(".ob-step")[obStep].querySelector("h2");
    $("#onboarding").setAttribute("aria-labelledby", title.id || (title.id = "ob-title-" + (obStep + 1)));
  }
  function openOnboarding(){
    obStep = 0;
    renderOnboardingStep();
    $("#onboarding").classList.add("open");
    setBackgroundInert($("#onboarding"), true);
    setTimeout(() => $("#ob-next").focus({ preventScroll:true }), 50);
  }
  function closeOnboarding(){
    $("#onboarding").classList.remove("open");
    setBackgroundInert($("#onboarding"), false);
    if(!data.onboardingDone){
      data.onboardingDone = true;
      saveData();
    }
    if(state.screen === "home") $("#play-btn").focus({ preventScroll:true });
  }
  $("#ob-next").addEventListener("click", () => {
    if(obStep < 2){ obStep++; renderOnboardingStep(); }
    else closeOnboarding();
  });
  $("#ob-skip").addEventListener("click", closeOnboarding);

  /* =========================================================
     11. INICIALIZACIÓN
  ========================================================= */

  /* Tooltip "¿Qué significa quemar los barcos?": position:fixed calculado
     en JS para que nunca quede recortado ni se salga de la pantalla. */
  function setupTooltip(){
    const dot = $("#phrase-tooltip-wrap .info-dot");
    const panel = $("#phrase-tooltip-wrap .tooltip-panel");
    if(!dot || !panel) return;
    let pinned = false;

    function positionPanel(){
      const dotRect = dot.getBoundingClientRect();
      const margin = 16;
      const panelWidth = panel.offsetWidth;
      let left = dotRect.left;
      left = Math.min(left, window.innerWidth - panelWidth - margin);
      left = Math.max(left, margin);
      panel.style.left = left + "px";
      panel.style.top = (dotRect.bottom + 10) + "px";
    }
    function show(){ positionPanel(); panel.classList.add("tooltip-visible"); dot.setAttribute("aria-expanded","true"); }
    function hide(){ panel.classList.remove("tooltip-visible"); dot.setAttribute("aria-expanded","false"); }

    dot.addEventListener("mouseenter", show);
    dot.addEventListener("mouseleave", () => { if(!pinned) hide(); });
    dot.addEventListener("focus", show);
    dot.addEventListener("blur", () => { if(!pinned) hide(); });
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      pinned = !pinned;
      if(pinned) show(); else hide();
    });
    document.addEventListener("click", (e) => {
      if(pinned && !e.target.closest("#phrase-tooltip-wrap")){
        pinned = false;
        hide();
      }
    });
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape" && panel.classList.contains("tooltip-visible")){ pinned = false; hide(); }
    });
    window.addEventListener("resize", () => {
      if(panel.classList.contains("tooltip-visible")) positionPanel();
    });
  }

  function applyMirror(){
    const toggle = $("#mirror-toggle");
    toggle.checked = !!data.mirrorMode;
    $(".app-shell").classList.toggle("mirror-mode", toggle.checked);
  }
  function setupMirrorToggle(){
    applyMirror();
    $("#mirror-toggle").addEventListener("change", (e) => {
      data.mirrorMode = e.target.checked;
      saveData();
      $(".app-shell").classList.toggle("mirror-mode", e.target.checked);
    });
  }

  // "Sorpréndeme": mantener pulsado 2s el logo del topbar elige un reto de
  // CUALQUIER categoría, saltándose el selector, como un gesto oculto.
  function setupLogoLongPress(){
    const logoBtn = document.querySelector('#topbar [data-nav="home"]');
    if(!logoBtn) return;
    let pressTimer = null;
    let longPressFired = false;

    function start(){
      longPressFired = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if(data.activeChallenge){
          longPressFired = true;
          resumeActive();
          return;
        }
        if(serverDrawsOn()){
          longPressFired = true;
          showToast("Sorpréndeme activado.");
          launchServerDraw("todos", { surprise:true });
          return;
        }
        const chosen = Core.pickChallenge(drawView(), "todos");
        if(!chosen) return;
        longPressFired = true;
        vibrate([20, 40, 20, 40, 30]);
        showToast("Sorpréndeme activado.");
        launchChallenge(chosen);
      }, 2000);
    }
    function cancel(){ clearTimeout(pressTimer); }

    logoBtn.addEventListener("pointerdown", start);
    logoBtn.addEventListener("pointerup", cancel);
    logoBtn.addEventListener("pointercancel", cancel);
    logoBtn.addEventListener("pointerleave", cancel);
    logoBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    logoBtn.addEventListener("click", (e) => {
      if(longPressFired){ e.preventDefault(); e.stopImmediatePropagation(); longPressFired = false; }
    }, true);
  }

  // Deslizar hacia los lados en la home: a la izquierda abre Progreso, a la
  // derecha abre Retos pendientes. No interfiere con el selector de categorías.
  function setupHomeSwipe(){
    const el = $("#screen-home");
    if(!el) return;
    let startX = 0, startY = 0, tracking = false;

    el.addEventListener("touchstart", (e) => {
      if(e.target.closest("#category-selector") || e.touches.length > 1) { tracking = false; return; }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }, { passive:true });

    el.addEventListener("touchend", (e) => {
      if(!tracking) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if(Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5){
        vibrate(10);
        if(dx < 0) goTo("progress");
        else goTo("pending");
      }
    }, { passive:true });
  }

  // Volver a la app tras bloquear el móvil o cambiar de app.
  function setupVisibility(){
    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState !== "visible") return;
      if(state.screen === "play"){
        requestWakeLock();
        if(state.timerHandle) tickCountdown(false);
      }
      if(state.screen === "home") renderHome();
      maybeRefreshCatalog();
    });
  }

  document.addEventListener("keydown", (e) => {
    if(e.key !== "Escape") return;
    if($("#sheet").classList.contains("open")) closeSheet();
    else if($("#onboarding").classList.contains("open")) closeOnboarding();
  });

  /* ---------- Actualizaciones de la app ---------- */
  function showUpdateBanner(){
    // Nunca en mitad de un reto (podrías estar grabando).
    if(state.screen === "play"){ state.pendingUpdate = true; return; }
    $("#update-banner").classList.add("show");
  }
  $("#update-btn").addEventListener("click", () => window.location.reload());

  function registerServiceWorker(){
    if(!("serviceWorker" in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if(!hadController){ hadController = true; return; }
      state.pendingUpdate = true;
      showUpdateBanner();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        document.addEventListener("visibilitychange", () => {
          if(document.visibilityState === "visible") reg.update().catch(() => {});
        });
      }).catch(() => {});
    });
  }


  /* =========================================================
     12. CATÁLOGO REMOTO Y ADMINISTRACIÓN
     El catálogo vive en Supabase. La app arranca con la última copia
     guardada (o los 103 de serie) y la actualiza en segundo plano: si no
     hay conexión o el servidor no responde, el juego sigue igual.
  ========================================================= */
  const Cloud = window.InergoCloud;
  const cloudOn = !!(Cloud && Cloud.enabled());
  const CATALOG_MAX_AGE = 5 * 60 * 1000;
  let lastCatalogFetch = 0;
  const admin = { rows: [], filter: "todos", editingId: null, email: null, isAdmin: null };

  function applyCatalogRows(rows){
    const list = Core.normalizeCatalog(rows);
    if(!list) return false;
    Core.setCatalog(list);
    return true;
  }

  function loadCachedCatalog(){
    if(!cloudOn) return;
    const cached = Cloud.readCachedCatalog();
    if(cached) applyCatalogRows(cached.rows);
  }

  function onCatalogChanged(){
    if(state.screen === "home") renderAvailableCount();
    if(state.screen === "mychallenges") renderMyChallenges();
  }

  async function refreshCatalog(){
    if(!cloudOn) return;
    lastCatalogFetch = Date.now();
    try{
      const rows = await Cloud.fetchCatalog();
      if(applyCatalogRows(rows)){
        Cloud.saveCachedCatalog(rows);
        onCatalogChanged();
      }
    }catch(e){ /* sin conexión o servidor en pausa: seguimos con la copia guardada */ }
  }

  function maybeRefreshCatalog(){
    if(Date.now() - lastCatalogFetch > CATALOG_MAX_AGE) refreshCatalog();
  }

  /* ---------- Panel de administración ---------- */
  function showBlock(el, on){
    el.classList.toggle("hidden", !on);
    el.classList.toggle("flex", on);
  }
  function setBusy(btn, busy, label){
    if(busy){ btn.dataset.label = btn.textContent; btn.textContent = label || "…"; }
    else if(btn.dataset.label){ btn.textContent = btn.dataset.label; }
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
  }

  // El sorteo solo ve el modo pruebas si un administrador lo tiene activo.
  function drawView(){ return Object.assign({}, data, { testMode: testActive() }); }

  // Comprueba en la base de datos si la sesión es de administrador y, si lo
  // es, habilita el modo pruebas. Sin sesión o sin permiso, queda apagado.
  async function refreshAdminRights(){
    let ok = false;
    const sess = cloudOn ? Cloud.getSession() : null;
    if(sess && !sess.anonymous){
      try{ ok = await Cloud.isAdmin(); }catch(e){ ok = false; }
    }
    testAllowed = ok;
    if(ok) admin.isAdmin = true;
    renderTestModeUI();
  }

  function renderAdminEntry(){
    // Todo el mundo tiene sesión (anónima o con cuenta): la entrada solo se
    // muestra tras el gesto secreto o a quien la base de datos reconoce como admin.
    const show = cloudOn && (adminDoor || testAllowed);
    $("#admin-section").classList.toggle("hidden", !show);
  }

  function showAdminView(view){
    showBlock($("#admin-login"), view === "login");
    showBlock($("#admin-denied"), view === "denied");
    showBlock($("#admin-panel"), view === "panel");
  }

  function showLoginStep(step){
    showBlock($("#admin-login-email"), step === "email");
    showBlock($("#admin-login-sent"), step === "sent");
  }

  async function renderAdmin(){
    if(!cloudOn){ showAdminView(null); showToast("La conexión con el servidor no está configurada."); return; }
    const session = Cloud.getSession();
    if(!session){
      showAdminView("login");
      showLoginStep(admin.email ? "sent" : "email");
      if(admin.email) $("#admin-email-sent").textContent = admin.email;
      return;
    }
    $all(".admin-session-email").forEach(el => { el.textContent = session.email || "tu cuenta"; });
    if(admin.isAdmin === null){
      showAdminView(null);
      try{
        admin.isAdmin = await Cloud.isAdmin();
        if(admin.isAdmin !== testAllowed){ testAllowed = !!admin.isAdmin; renderTestModeUI(); }
      }catch(e){
        showToast(e.message);
        if(!Cloud.getSession()){ admin.isAdmin = null; renderAdmin(); }
        return;
      }
    }
    if(!admin.isAdmin){ showAdminView("denied"); return; }
    showAdminView("panel");
    renderBarcoAdmin();
    updateAdminFormForCategory();
    await loadAdminRows();
  }

  async function renderBarcoAdmin(){
    const sel = $("#barco-admin-challenge");
    const keep = sel.value;
    sel.innerHTML = "";
    Core.getCatalog().forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = categoryLabel(c.category) + " · " + (c.text.length > 70 ? c.text.slice(0, 70) + "…" : c.text);
      sel.appendChild(o);
    });
    if(keep) sel.value = keep;
    const w = await loadBarco(true);
    $("#barco-admin-current").textContent = w
      ? "Ahora navega: «" + w.title + "», hasta el " + formatEnds(w.ends_at) + ". Si lanzas otro, sustituye a este."
      : "No hay ningún Barco activo.";
  }
  function setupBarcoAdmin(){
    $("#barco-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = $("#barco-admin-title").value.trim();
      const challengeId = $("#barco-admin-challenge").value;
      const days = Number($("#barco-admin-days").value) || 7;
      if(title.length < 3){ showToast("Ponle un título al Barco."); return; }
      if(!challengeId){ showToast("Elige un reto."); return; }
      const btn = $("#barco-admin-submit");
      setBusy(btn, true, "Lanzando…");
      try{
        const now = new Date();
        await Cloud.createWeekly({ challenge_id: challengeId, title,
          starts_at: now.toISOString(), ends_at: new Date(now.getTime() + days * 86400000).toISOString() });
        $("#barco-admin-title").value = "";
        barco.loadedAt = 0;
        showToast("Barco lanzado.");
        renderBarcoAdmin();
      }catch(err){ showToast(err.message); }
      setBusy(btn, false);
    });
  }

  async function loadAdminRows(){
    try{
      const rows = await Cloud.fetchCatalog({ includeInactive:true });
      admin.rows = Array.isArray(rows) ? rows : [];
      if(applyCatalogRows(admin.rows)) Cloud.saveCachedCatalog(admin.rows);
      renderAdminList();
    }catch(e){
      showToast(e.message);
    }
  }

  const ADMIN_POINTS_HINT = {
    espontanea: "+20 XP · cronómetro",
    experiencia: "+50 XP · se apunta en pendientes, sin cronómetro",
    reflexion: "+15 XP · cronómetro",
    conocimiento: "+20 XP · investigar 10 min y hablar 1 min"
  };

  function updateAdminFormForCategory(){
    const cat = $("#admin-category").value;
    $("#admin-duration-wrap").classList.toggle("hidden", Core.CATEGORY_TYPE[cat] !== "timer");
    $("#admin-points-hint").textContent = ADMIN_POINTS_HINT[cat] || "";
  }

  function resetAdminForm(){
    admin.editingId = null;
    $("#admin-text").value = "";
    $("#admin-category").value = "espontanea";
    $("#admin-duration").value = "300";
    $("#admin-form-title").textContent = "Nuevo reto";
    $("#admin-save").textContent = "Publicar reto";
    $("#admin-cancel-edit").classList.add("hidden");
    updateAdminFormForCategory();
  }

  function ensureDurationOption(seconds){
    const sel = $("#admin-duration");
    if(!Array.from(sel.options).some(o => Number(o.value) === seconds)){
      const opt = document.createElement("option");
      opt.value = String(seconds);
      opt.textContent = (seconds % 60 === 0 ? (seconds / 60) + " min" : seconds + " s");
      sel.appendChild(opt);
    }
    sel.value = String(seconds);
  }

  function editAdminRow(id){
    const row = admin.rows.find(r => r.id === id);
    if(!row) return;
    admin.editingId = id;
    $("#admin-text").value = row.text;
    $("#admin-category").value = row.category;
    if(row.duration_type === "timer" && row.duration_seconds) ensureDurationOption(row.duration_seconds);
    $("#admin-form-title").textContent = "Editar reto";
    $("#admin-save").textContent = "Guardar cambios";
    $("#admin-cancel-edit").classList.remove("hidden");
    updateAdminFormForCategory();
    const scroller = $("#screen-admin .overflow-y-auto");
    if(scroller) scroller.scrollTo({ top:0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    $("#admin-text").focus({ preventScroll:true });
  }

  async function saveAdminForm(e){
    if(e) e.preventDefault();
    const btn = $("#admin-save");
    let row;
    try{
      row = Core.challengeToCatalogRow({
        text: $("#admin-text").value,
        category: $("#admin-category").value,
        durationSeconds: parseInt($("#admin-duration").value, 10)
      });
    }catch(err){ showToast(err.message); $("#admin-text").focus(); return; }

    setBusy(btn, true, "Guardando…");
    try{
      if(admin.editingId){
        await Cloud.updateChallenge(admin.editingId, row);
        showToast("Reto actualizado.");
      }else{
        const maxOrder = admin.rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);
        row.id = Core.newCatalogId(row.category);
        row.sort_order = maxOrder + 10;
        row.active = true;
        await Cloud.createChallenge(row);
        showToast("Reto publicado. Ya puede salir al tirar.");
      }
      setBusy(btn, false);
      resetAdminForm();
      await loadAdminRows();
    }catch(err){
      setBusy(btn, false);
      showToast(err.message);
      if(err.status === 401 && !Cloud.getSession()){ admin.isAdmin = null; renderAdmin(); }
    }
  }

  async function toggleAdminRow(id, btn){
    const row = admin.rows.find(r => r.id === id);
    if(!row) return;
    setBusy(btn, true);
    try{
      await Cloud.updateChallenge(id, { active: !row.active });
      showToast(row.active ? "Reto desactivado: ya no saldrá al tirar." : "Reto activado.");
      await loadAdminRows();
    }catch(err){
      setBusy(btn, false);
      showToast(err.message);
    }
  }

  function adminDurationLabel(row){
    if(row.duration_type === "pending") return "PENDIENTE";
    if(row.duration_type === "research") return Math.round(row.research_seconds/60) + " MIN + " + Math.round(row.talk_seconds/60) + " MIN";
    const s = Number(row.duration_seconds) || 0;
    return s % 60 === 0 ? (s/60) + " MIN" : s + " S";
  }

  function renderAdminFilter(){
    const wrap = $("#admin-filter");
    wrap.innerHTML = "";
    CATEGORIES.forEach(cat => {
      const count = cat.id === "todos" ? admin.rows.length : admin.rows.filter(r => r.category === cat.id).length;
      const b = document.createElement("button");
      const selected = admin.filter === cat.id;
      b.className = "chip rounded-full px-4 py-2 font-display font-bold text-xs tracking-wide shrink-0" + (selected ? " selected" : "");
      b.textContent = cat.label + " · " + count;
      b.setAttribute("aria-pressed", selected ? "true" : "false");
      b.addEventListener("click", () => { admin.filter = cat.id; renderAdminList(); });
      wrap.appendChild(b);
    });
  }

  function renderAdminList(){
    renderAdminFilter();
    const list = $("#admin-list");
    list.innerHTML = "";
    const rows = admin.rows
      .filter(r => admin.filter === "todos" || r.category === admin.filter)
      .slice()
      .sort((a, b) => (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0));
    const active = admin.rows.filter(r => r.active).length;
    const inactive = admin.rows.length - active;
    $("#admin-count").textContent = active + (active === 1 ? " activo · " : " activos · ") + inactive + (inactive === 1 ? " desactivado" : " desactivados");
    if(rows.length === 0){
      list.innerHTML = `<p class="font-medium text-sm opacity-60 py-2">No hay retos en esta categoría.</p>`;
      return;
    }
    rows.forEach(r => {
      const row = document.createElement("div");
      row.className = "flex items-start gap-3 py-3 border-b" + (r.active ? "" : " admin-row-inactive");
      row.style.borderColor = "var(--line-soft)";
      row.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="font-medium text-sm leading-snug">${escapeHtml(r.text)}</p>
          <p class="font-num text-[10px] opacity-70 mt-1 uppercase">${escapeHtml(categoryLabel(r.category))} · ${escapeHtml(adminDurationLabel(r))}${r.active ? "" : " · desactivado"}</p>
        </div>
        <div class="flex flex-col gap-2 shrink-0">
          <button class="btn-ghost rounded-full px-4 py-1.5 text-[11px] font-bold" data-admin-edit="${escapeHtml(r.id)}">Editar</button>
          <button class="btn-ghost rounded-full px-4 py-1.5 text-[11px] font-bold" data-admin-toggle="${escapeHtml(r.id)}">${r.active ? "Desactivar" : "Activar"}</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-admin-edit]").forEach(b => b.addEventListener("click", () => editAdminRow(b.dataset.adminEdit)));
    list.querySelectorAll("[data-admin-toggle]").forEach(b => b.addEventListener("click", () => toggleAdminRow(b.dataset.adminToggle, b)));
  }

  function setupAdmin(){
    if(!cloudOn) return;
    $("#admin-send-link").addEventListener("click", async () => {
      const btn = $("#admin-send-link");
      setBusy(btn, true, "Enviando…");
      try{
        admin.email = await Cloud.sendLink($("#admin-email").value);
        $("#admin-email-sent").textContent = admin.email;
        showLoginStep("sent");
        showToast("Enlace enviado. Mira tu email.");
      }catch(e){ showToast(e.message); }
      setBusy(btn, false);
    });
    $("#admin-email").addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); $("#admin-send-link").click(); } });
    $("#admin-resend").addEventListener("click", async () => {
      const btn = $("#admin-resend");
      setBusy(btn, true, "Enviando…");
      try{
        await Cloud.sendLink(admin.email);
        showToast("Enlace reenviado.");
      }catch(e){ showToast(e.message); }
      setBusy(btn, false);
    });
    // El enlace suele abrirse en otra pestaña: cuando allí se inicia sesión,
    // esta pestaña se entera y entra sola.
    window.addEventListener("storage", (e) => {
      if(e.key !== Cloud.AUTH_KEY) return;
      admin.isAdmin = null;
      admin.email = null;
      renderAdminEntry();
      refreshAdminRights();
      if(state.screen === "admin") renderAdmin();
      if(e.newValue) showToast("Sesión iniciada.");
    });
    $("#admin-change-email").addEventListener("click", () => { admin.email = null; showLoginStep("email"); $("#admin-email").focus(); });
    $all(".admin-signout").forEach(b => b.addEventListener("click", async () => {
      await Cloud.signOut();
      admin.isAdmin = null;
      testAllowed = false;
      admin.rows = [];
      resetAdminForm();
      renderAdminEntry();
      showToast("Sesión cerrada.");
      renderAdmin();
    }));
    $("#admin-category").addEventListener("change", updateAdminFormForCategory);
    $("#admin-form").addEventListener("submit", saveAdminForm);
    $("#admin-cancel-edit").addEventListener("click", resetAdminForm);
    resetAdminForm();
  }

  // Vuelta desde el enlace del email: la sesión llega en la URL.
  function consumeLoginRedirect(){
    if(!cloudOn) return false;
    const r = Cloud.consumeUrlSession();
    if(!r) return false;
    // Quien entra como administrador no necesita la introducción.
    if(!data.onboardingDone){ data.onboardingDone = true; saveData(); }
    // Con error (enlace caducado) también se va al catálogo, para pedir otro.
    showToast(r.error || "Sesión iniciada.");
    return true;
  }

  // Enlaces directos: inergo.html?s=pending | progress | mychallenges | settings
  function initialScreenFromUrl(){
    try{
      const s = new URLSearchParams(window.location.search).get("s");
      return ["pending","progress","mychallenges","settings"].includes(s) ? s : null;
    }catch(e){ return null; }
  }

  function init(){
    loadCachedCatalog();
    resetForm();
    setupTooltip();
    setupMirrorToggle();
    setupLogoLongPress();
    setupHomeSwipe();
    setupSettings();
    setupVisibility();
    updatePendingBadge();
    registerServiceWorker();
    applyTestModeFromUrl();
    setupAdmin();
    if(cloudOn){ setupAccount(); setupBarcoAdmin(); }
    renderTestModeUI();
    refreshAdminRights();
    if(cloudOn){
      Cloud.flushOutbox().catch(() => {});
      window.addEventListener("online", () => Cloud.flushOutbox().catch(() => {}));
    }

    const fromLoginLink = consumeLoginRedirect();
    // Por si el enlace se abre con la app ya cargada en esa misma pestaña.
    window.addEventListener("hashchange", () => {
      if(!consumeLoginRedirect()) return;
      admin.isAdmin = null;
      admin.email = null;
      renderAdminEntry();
      refreshAdminRights();
      goTo("admin");
    });
    const deepLink = fromLoginLink ? "admin" : initialScreenFromUrl();
    if(deepLink){
      goTo(deepLink, { silentFocus:true });
    }else if(data.activeChallenge){
      // Reto en marcha: la app te devuelve a él directamente.
      goTo("home", { silentFocus:true });
      resumeActive();
    }else{
      goTo("home", { silentFocus:true });
    }

    if(!data.onboardingDone && !data.activeChallenge && !fromLoginLink) openOnboarding();
    refreshCatalog();
  }

  init();

})();
