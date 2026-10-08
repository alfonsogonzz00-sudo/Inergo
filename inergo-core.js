/* =========================================================
   INERGO — núcleo de dominio
   ---------------------------------------------------------
   Lógica pura, sin DOM: catálogo de retos, sorteo, XP, racha,
   reto activo y normalización/migración de datos guardados.
   Se carga en el navegador como script clásico (expone
   window.InergoCore) y en Node para los tests (module.exports).
========================================================= */
(function(root, factory){
  "use strict";
  const api = factory();
  if(typeof module !== "undefined" && module.exports){
    module.exports = api;
  }else{
    root.InergoCore = api;
  }
})(typeof self !== "undefined" ? self : this, function(){
  "use strict";

  const APP_VERSION = "2.1.2";
  const STORAGE_KEY = "inergo_data_v1"; // NO cambiar: contiene el progreso de los usuarios
  const SCHEMA_VERSION = 2;

  /* =========================================================
     1. DATOS — RETOS PREDEFINIDOS
  ========================================================= */
  const CATEGORIES = [
    { id:"todos", label:"TODOS" },
    { id:"espontanea", label:"ESPONTÁNEA" },
    { id:"experiencia", label:"EXPERIENCIA" },
    { id:"reflexion", label:"REFLEXIÓN" },
    { id:"conocimiento", label:"CONOCIMIENTO" }
  ];
  const STAT_KEYS = ["espontanea","experiencia","reflexion","conocimiento"];
  // Los retos personalizados no pueden ser de "Conocimiento" (mecánica de dos fases propia).
  const CUSTOM_CATEGORIES = ["espontanea","experiencia","reflexion"];
  const CUSTOM_DURATIONS = [120, 300, 600, 900, 1800, 3600];
  const CUSTOM_CHALLENGE_POINTS = 25;

  // Sin puntuación de dificultad visible: cada reto lleva unos XP fijos
  // según su categoría (espontánea 20, experiencia 50, reflexión 15).
  function mk(id, text, category, duration, points){
    return { id, text, category, durationType:"timer", duration, points };
  }
  // Reto "pendiente": sin cronómetro ni fecha límite calculada por la app —
  // el "cuándo" va escrito dentro del propio texto del reto. Se guarda en
  // "Retos pendientes" hasta que lo marques como hecho.
  function mkP(id, text, category, points){
    return { id, text, category, durationType:"pending", points };
  }
  // Reto de "Conocimiento": dos fases fijas — investigar 10 min, hablar 1 min.
  function mkK(id, text){
    return { id, text, category:"conocimiento", durationType:"research", researchDuration:600, talkDuration:60, points:20 };
  }

  const DEFAULT_CHALLENGES = [
    // ESPONTÁNEA — se hace ahora mismo, unos 30 min como mucho.
    mk("espontanea-001","Sal a la calle ahora mismo y hazle un cumplido sincero y específico a 3 desconocidos, grabando su reacción.","espontanea",900,20),
    mk("espontanea-002","Entra en una tienda y pide un descuento sin ningún motivo real, solo porque sí.","espontanea",300,20),
    mk("espontanea-003","Pide un abrazo a un desconocido por la calle, tras hablar con él.","espontanea",420,20),
    mk("espontanea-004","Llama ahora mismo a alguien con quien no hablas hace tiempo y dile en voz alta por qué te importó.","espontanea",600,20),
    mk("espontanea-005","Mirando fijamente a cámara, confiesa algo que te avergüenza y que nunca has contado a nadie.","espontanea",300,20),
    mk("espontanea-006","Pregunta a un desconocido cuál es su mayor arrepentimiento en la vida.","espontanea",480,20),
    mk("espontanea-007","Entra en una tienda de ropa que nunca pisarías, pruébate algo y pide la opinión sincera a un desconocido dentro del probador.","espontanea",900,20),
    mk("espontanea-008","Pide en un bar o restaurante que te recomienden algo \"para impresionar a alguien\" y cuéntales por qué lo necesitas.","espontanea",600,20),
    mk("espontanea-009","Pide a un desconocido que te haga una crítica honesta de tu outfit de hoy.","espontanea",300,20),
    mk("espontanea-010","Ve a la sección de perfumería o cosmética de una tienda y pide a un dependiente que te maquille o te ponga colonia mientras la gente mira.","espontanea",900,20),
    mk("espontanea-011","Pide a alguien random que pasa por la calle que te dé un consejo de vida en 30 segundos.","espontanea",300,20),
    mk("espontanea-012","Pide a un grupo de desconocidos que se echen una foto contigo sin dar ninguna razón.","espontanea",480,20),
    mk("espontanea-013","Aprende qué es un suceso, un concepto científico o algo muy nicho de una disciplina que no domines, y explícalo sin muletillas durante 1 minuto. Tienes 20 minutos para investigarlo y grabarte explicándolo.","espontanea",1200,20),

    // EXPERIENCIA — sin cronómetro ni fecha límite: el "cuándo" va escrito en
    // el propio texto del reto ("mañana temprano", "el próximo fin de semana"...).
    // Se apunta en "Retos pendientes" hasta que lo marques como hecho.
    mkP("experiencia-001","Ve a un pueblo o barrio a menos de 15 minutos de donde vives, cena allí completamente solo y date una vuelta.","experiencia",50),
    mkP("experiencia-002","Ve solo al cine a la sesión con el horario más raro que encuentres y cuenta cómo te sentiste al salir.","experiencia",50),
    mkP("experiencia-003","Haz autostop real o pide ayuda a un desconocido para resolver algo que necesitas hoy.","experiencia",50),
    mkP("experiencia-004","Preséntate en persona (sin cita previa) en un sitio donde te gustaría trabajar o colaborar, y pide hablar con alguien.","experiencia",50),
    mkP("experiencia-005","Sal de tu ciudad un día entero sin planear nada: elige destino la misma mañana.","experiencia",50),
    mkP("experiencia-006","Cuenta tu mayor miedo en voz alta a un grupo de amigos reunidos, sin quitarle importancia después.","experiencia",50),
    mkP("experiencia-007","Ve solo a un evento social donde no conozcas a nadie y no te vayas hasta haber hablado con 3 personas nuevas.","experiencia",50),
    mkP("experiencia-008","Pide trabajo temporal de un día (ayudar en un negocio, repartir, lo que sea) tocando puertas sin experiencia previa en ello.","experiencia",50),
    mkP("experiencia-009","Pasa 24 horas comiendo únicamente lo que te recomiende gente random que pares por la calle.","experiencia",50),
    mkP("experiencia-010","Levántate mañana antes del amanecer, ve a verlo y grábalo.","experiencia",50),

    // REFLEXIÓN — "Reflexiona sobre X." Cronómetro fijo de 1 minuto hablando en voz alta del tema.
    mk("reflexion-001","Reflexiona en voz alta sobre: el miedo al fracaso.","reflexion",60,15),
    mk("reflexion-002","Reflexiona en voz alta sobre: el miedo a lo que piensan los demás de ti.","reflexion",60,15),
    mk("reflexion-003","Reflexiona en voz alta sobre: la última vez que mentiste, y por qué.","reflexion",60,15),
    mk("reflexion-004","Reflexiona en voz alta sobre: algo que te arrepientes de no haber dicho.","reflexion",60,15),
    mk("reflexion-005","Reflexiona en voz alta sobre: tu mayor inseguridad física.","reflexion",60,15),
    mk("reflexion-006","Reflexiona en voz alta sobre: la persona a la que más admiras, y por qué.","reflexion",60,15),
    mk("reflexion-007","Reflexiona en voz alta sobre: el día que más miedo has pasado en tu vida.","reflexion",60,15),
    mk("reflexion-008","Reflexiona en voz alta sobre: algo que finges que no te importa, pero sí te importa.","reflexion",60,15),
    mk("reflexion-009","Reflexiona en voz alta sobre: lo que harías si supieras que no vas a fracasar.","reflexion",60,15),
    mk("reflexion-010","Reflexiona en voz alta sobre: la relación que más te ha marcado, para bien o para mal.","reflexion",60,15),
    mk("reflexion-011","Reflexiona en voz alta sobre: qué es el éxito para ti, de verdad.","reflexion",60,15),
    mk("reflexion-012","Reflexiona en voz alta sobre: algo que le dirías a tu yo de hace 5 años.","reflexion",60,15),
    mk("reflexion-013","Reflexiona en voz alta sobre: el motivo real por el que procrastinas.","reflexion",60,15),
    mk("reflexion-014","Reflexiona en voz alta sobre: qué harías si solo te quedara un año de vida.","reflexion",60,15),
    mk("reflexion-015","Reflexiona en voz alta sobre: cómo te afecta compararte con otros.","reflexion",60,15),
    mk("reflexion-016","Reflexiona en voz alta sobre: un error que cambió tu forma de ver la vida.","reflexion",60,15),
    mk("reflexion-017","Reflexiona en voz alta sobre: qué es lo que más evitas sentir.","reflexion",60,15),
    mk("reflexion-018","Reflexiona en voz alta sobre: tu relación con el dinero.","reflexion",60,15),
    mk("reflexion-019","Reflexiona en voz alta sobre: lo que de verdad piensas de la muerte.","reflexion",60,15),
    mk("reflexion-020","Reflexiona en voz alta sobre: algo que llevas mucho tiempo posponiendo, y por qué.","reflexion",60,15),

    // CONOCIMIENTO — términos y hechos muy poco conocidos, casi nadie sabrá de
    // qué van de entrada. Mecánica de dos fases: INVESTIGAR (10 min) → HABLAR (1 min).

    // Medicina
    mkK("conocimiento-001","Investiga qué es la xantopsia y prepárate para explicarlo."),
    mkK("conocimiento-002","Investiga qué es la cataplejía y prepárate para explicarlo."),
    mkK("conocimiento-003","Investiga qué es la anosognosia y prepárate para explicarlo."),
    mkK("conocimiento-004","Investiga qué es la acalasia y prepárate para explicarlo."),
    mkK("conocimiento-005","Investiga qué es la miosis y prepárate para explicarlo."),
    mkK("conocimiento-006","Investiga qué es la aloimunización y prepárate para explicarlo."),
    mkK("conocimiento-007","Investiga qué es la xerostomía y prepárate para explicarlo."),
    mkK("conocimiento-008","Investiga qué es la disautonomía y prepárate para explicarlo."),
    mkK("conocimiento-009","Investiga qué es la paramnesia reduplicativa y prepárate para explicarlo."),
    mkK("conocimiento-010","Investiga qué es la coprolalia y prepárate para explicarlo."),

    // Ciencia
    mkK("conocimiento-011","Investiga qué es el efecto Mpemba y prepárate para explicarlo."),
    mkK("conocimiento-012","Investiga qué es la superfluidez y prepárate para explicarlo."),
    mkK("conocimiento-013","Investiga qué es la radiación de Cherenkov y prepárate para explicarlo."),
    mkK("conocimiento-014","Investiga qué es el punto triple de una sustancia y prepárate para explicarlo."),
    mkK("conocimiento-015","Investiga qué es el efecto Casimir y prepárate para explicarlo."),
    mkK("conocimiento-016","Investiga qué es el efecto Leidenfrost y prepárate para explicarlo."),
    mkK("conocimiento-017","Investiga qué es el diamagnetismo y prepárate para explicarlo."),
    mkK("conocimiento-018","Investiga qué es el efecto Coriolis y prepárate para explicarlo."),
    mkK("conocimiento-019","Investiga qué es la superconductividad y prepárate para explicarlo."),
    mkK("conocimiento-020","Investiga qué es el efecto túnel cuántico y prepárate para explicarlo."),

    // Naturaleza
    mkK("conocimiento-021","Investiga qué es la partenogénesis y prepárate para explicarlo."),
    mkK("conocimiento-022","Investiga qué es la mixotrofia y prepárate para explicarlo."),
    mkK("conocimiento-023","Investiga qué es la diapausa y prepárate para explicarlo."),
    mkK("conocimiento-024","Investiga qué es la endosimbiosis y prepárate para explicarlo."),
    mkK("conocimiento-025","Investiga qué es la alelopatía y prepárate para explicarlo."),
    mkK("conocimiento-026","Investiga qué es la apoptosis y prepárate para explicarlo."),
    mkK("conocimiento-027","Investiga qué es la quimiotaxis y prepárate para explicarlo."),
    mkK("conocimiento-028","Investiga qué es la micorriza y prepárate para explicarlo."),
    mkK("conocimiento-029","Investiga qué es la criptobiosis y prepárate para explicarlo."),
    mkK("conocimiento-030","Investiga qué es el epifitismo y prepárate para explicarlo."),

    // Geología
    mkK("conocimiento-031","Investiga qué es un piroclasto y prepárate para explicarlo."),
    mkK("conocimiento-032","Investiga qué es el relieve kárstico y prepárate para explicarlo."),
    mkK("conocimiento-033","Investiga qué es una diaclasa y prepárate para explicarlo."),
    mkK("conocimiento-034","Investiga qué es la isostasia y prepárate para explicarlo."),
    mkK("conocimiento-035","Investiga qué es la tefra y prepárate para explicarlo."),
    mkK("conocimiento-036","Investiga qué es un xenolito y prepárate para explicarlo."),
    mkK("conocimiento-037","Investiga qué es la estratigrafía y prepárate para explicarlo."),
    mkK("conocimiento-038","Investiga qué es la subducción de placas y prepárate para explicarlo."),
    mkK("conocimiento-039","Investiga qué es un lacolito y prepárate para explicarlo."),
    mkK("conocimiento-040","Investiga qué son las varvas y prepárate para explicarlo."),

    // Psicología
    mkK("conocimiento-041","Investiga qué es la apofenia y prepárate para explicarlo."),
    mkK("conocimiento-042","Investiga qué es el efecto Zeigarnik y prepárate para explicarlo."),
    mkK("conocimiento-043","Investiga qué es la criptomnesia y prepárate para explicarlo."),
    mkK("conocimiento-044","Investiga qué es el efecto Barnum y prepárate para explicarlo."),
    mkK("conocimiento-045","Investiga qué es el condicionamiento clásico de Pavlov y prepárate para explicarlo."),
    mkK("conocimiento-046","Investiga qué es el efecto halo y prepárate para explicarlo."),
    mkK("conocimiento-047","Investiga qué es la disonancia cognitiva y prepárate para explicarlo."),
    mkK("conocimiento-048","Investiga qué es el efecto Pigmalión y prepárate para explicarlo."),
    mkK("conocimiento-049","Investiga qué es el sesgo de anclaje y prepárate para explicarlo."),
    mkK("conocimiento-050","Investiga qué es el efecto espectador y prepárate para explicarlo."),

    // Historia
    mkK("conocimiento-051","Investiga en qué consistió el Cisma de Occidente y prepárate para explicarlo."),
    mkK("conocimiento-052","Investiga en qué consistió la Guerra de la Oreja de Jenkins y prepárate para explicarlo."),
    mkK("conocimiento-053","Investiga en qué consistió la Peste de Justiniano y prepárate para explicarlo."),
    mkK("conocimiento-054","Investiga en qué consistió el Incidente de Mukden y prepárate para explicarlo."),
    mkK("conocimiento-055","Investiga en qué consistió la Rebelión de los Bóxers y prepárate para explicarlo."),
    mkK("conocimiento-056","Investiga en qué consistió el Tratado de Tordesillas y prepárate para explicarlo."),
    mkK("conocimiento-057","Investiga en qué consistió la Matanza de Katyn y prepárate para explicarlo."),
    mkK("conocimiento-058","Investiga en qué consistió la Defenestración de Praga y prepárate para explicarlo."),
    mkK("conocimiento-059","Investiga en qué consistió el Cisma de 1054 entre las Iglesias católica y ortodoxa y prepárate para explicarlo."),
    mkK("conocimiento-060","Investiga en qué consistió la Guerra de las Comunidades de Castilla y prepárate para explicarlo.")
  ];

  /* El catálogo vivo viene de Supabase (ver js/inergo-cloud.js). Estos 103
     retos son la copia de serie: se usan la primera vez sin conexión o si
     el servidor no responde. */
  let catalog = DEFAULT_CHALLENGES;

  const MICROCOPY = ["NO HAY VUELTA ATRÁS.","PIÉNSALO MENOS.","AHORA HAZLO.","NO HAY EXCUSAS.","DEJA DE PENSAR.","YA LO HAS VISTO.","EMPIEZA."];

  // Frase que acompaña siempre la selección y la revelación del reto.
  const SPIN_PHRASE = "Quemando los barcos.";

  const HISTORY_LIMIT = 40;
  const RECENT_LIMIT = 6;

  /* =========================================================
     2. MODELO DE DATOS
  ========================================================= */
  function defaultData(){
    return {
      schemaVersion: SCHEMA_VERSION,
      customChallenges: [],
      disabledDefaultIds: [],
      completedLog: [],      // {id, text, category, completedAt, xp}
      recentIds: [],         // últimos N ids mostrados/completados, para evitar repeticiones inmediatas
      pendingChallenges: [], // retos de Experiencia apuntados, sin plazo: {activeId, challengeId, text, category, points, savedAt}
      activeChallenge: null, // reto revelado y aún no terminado (ver createActive)
      mirrorMode: false,
      soundOn: true,
      hapticsOn: true,
      onboardingDone: false,
      testMode: false,       // modo pruebas: permite saltar un reto revelado (solo para testear)
      xp: 0,
      streak: 0,
      lastCompletedDate: null,
      stats: { espontanea:0, experiencia:0, reflexion:0, conocimiento:0 },
      selectedCategory: "todos"
    };
  }

  /* ---------- Validadores pequeños ---------- */
  function isObj(v){ return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v, max){
    if(typeof v !== "string") return null;
    const t = v.trim();
    if(!t) return null;
    return max ? t.slice(0, max) : t;
  }
  function nonNegInt(v, fallback){
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  }
  function bool(v, fallback){ return typeof v === "boolean" ? v : fallback; }
  const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
  function safeId(v){ return typeof v === "string" && SAFE_ID.test(v) ? v : null; }
  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  function normalizeCustom(c){
    if(!isObj(c)) return null;
    const id = safeId(c.id);
    const text = str(c.text, 180);
    if(!id || !text) return null;
    const category = CUSTOM_CATEGORIES.includes(c.category) ? c.category : "espontanea";
    let duration = nonNegInt(c.duration, 300);
    if(duration < 30 || duration > 3600) duration = 300;
    return mk(id, text, category, duration, CUSTOM_CHALLENGE_POINTS);
  }

  function normalizeChallengeSnapshot(c){
    if(!isObj(c)) return null;
    const id = safeId(c.id);
    const text = str(c.text, 400);
    if(!id || !text || !STAT_KEYS.includes(c.category)) return null;
    const points = nonNegInt(c.points, 0);
    if(c.durationType === "pending") return mkP(id, text, c.category, points);
    if(c.durationType === "research"){
      return {
        id, text, category:c.category, durationType:"research",
        researchDuration: nonNegInt(c.researchDuration, 600) || 600,
        talkDuration: nonNegInt(c.talkDuration, 60) || 60,
        points
      };
    }
    if(c.durationType === "timer"){
      const duration = nonNegInt(c.duration, 0);
      if(!duration) return null;
      return mk(id, text, c.category, duration, points);
    }
    return null;
  }

  const ACTIVE_PHASES = ["spinning","revealed","timer","research","researchDone","talk","finished"];
  const TIMED_PHASES = ["timer","research","talk"];

  function normalizeActive(a){
    if(!isObj(a)) return null;
    const challenge = normalizeChallengeSnapshot(a.challenge);
    if(!challenge || !ACTIVE_PHASES.includes(a.phase)) return null;
    const out = {
      challenge,
      phase: a.phase,
      launchedAt: nonNegInt(a.launchedAt, 0),
      endsAt: null,
      total: null,
      microcopy: typeof a.microcopy === "string" ? a.microcopy.slice(0, 60) : null
    };
    if(TIMED_PHASES.includes(a.phase)){
      const endsAt = nonNegInt(a.endsAt, 0);
      const total = nonNegInt(a.total, 0);
      if(!endsAt || !total) return null;
      out.endsAt = endsAt;
      out.total = total;
    }
    return out;
  }

  /**
   * Fusiona datos guardados (o importados) con los valores por defecto,
   * validando cada campo. Nunca lanza: lo que no se entiende se descarta.
   */
  function normalizeData(parsed){
    const base = defaultData();
    if(!isObj(parsed)) return base;
    const isLegacy = parsed.schemaVersion === undefined;

    base.customChallenges = Array.isArray(parsed.customChallenges)
      ? parsed.customChallenges.map(normalizeCustom).filter(Boolean)
      : [];
    // Ids duplicados en personalizados: se conserva el primero.
    const seenCustom = new Set();
    base.customChallenges = base.customChallenges.filter(c => !seenCustom.has(c.id) && seenCustom.add(c.id));

    base.disabledDefaultIds = Array.isArray(parsed.disabledDefaultIds)
      ? Array.from(new Set(parsed.disabledDefaultIds.filter(id => safeId(id)))).slice(0, 2000)
      : [];

    base.completedLog = Array.isArray(parsed.completedLog)
      ? parsed.completedLog.map(e => {
          if(!isObj(e)) return null;
          const text = str(e.text, 400);
          if(!text) return null;
          return {
            id: safeId(e.id) || "desconocido",
            text,
            category: STAT_KEYS.includes(e.category) ? e.category : "espontanea",
            completedAt: typeof e.completedAt === "string" ? e.completedAt.slice(0, 40) : new Date(0).toISOString(),
            xp: nonNegInt(e.xp, 0)
          };
        }).filter(Boolean).slice(0, HISTORY_LIMIT)
      : [];

    base.recentIds = Array.isArray(parsed.recentIds)
      ? parsed.recentIds.filter(id => safeId(id)).slice(0, RECENT_LIMIT)
      : [];

    base.pendingChallenges = Array.isArray(parsed.pendingChallenges)
      ? parsed.pendingChallenges.map(p => {
          if(!isObj(p)) return null;
          const activeId = safeId(p.activeId);
          const challengeId = safeId(p.challengeId);
          const text = str(p.text, 400);
          if(!activeId || !challengeId || !text) return null;
          return {
            activeId, challengeId, text,
            category: STAT_KEYS.includes(p.category) ? p.category : "experiencia",
            points: nonNegInt(p.points, 0),
            savedAt: nonNegInt(p.savedAt, Date.now())
          };
        }).filter(Boolean)
      : [];

    base.activeChallenge = normalizeActive(parsed.activeChallenge);
    base.mirrorMode = bool(parsed.mirrorMode, false);
    base.soundOn = bool(parsed.soundOn, true);
    base.hapticsOn = bool(parsed.hapticsOn, true);
    // Quien ya usaba INERGO antes de esta versión no tiene que ver la introducción.
    base.onboardingDone = isLegacy ? true : bool(parsed.onboardingDone, false);
    base.testMode = bool(parsed.testMode, false);
    base.xp = nonNegInt(parsed.xp, 0);
    base.streak = nonNegInt(parsed.streak, 0);
    base.lastCompletedDate = typeof parsed.lastCompletedDate === "string" && DATE_KEY.test(parsed.lastCompletedDate)
      ? parsed.lastCompletedDate : null;
    if(isObj(parsed.stats)){
      STAT_KEYS.forEach(k => { base.stats[k] = nonNegInt(parsed.stats[k], 0); });
    }
    // Si la categoría guardada ya no existe, vuelve a "TODOS" en vez de
    // dejar la app filtrando silenciosamente sobre una categoría fantasma.
    base.selectedCategory = CATEGORIES.some(c => c.id === parsed.selectedCategory) ? parsed.selectedCategory : "todos";
    return base;
  }

  /* =========================================================
     2b. CATÁLOGO REMOTO (filas de la tabla public.challenges)
  ========================================================= */
  const CATALOG_ID = /^[a-z0-9-]{1,80}$/;
  const CATEGORY_TYPE = { espontanea:"timer", reflexion:"timer", experiencia:"pending", conocimiento:"research" };
  const CATEGORY_POINTS = { espontanea:20, experiencia:50, reflexion:15, conocimiento:20 };

  // Convierte una fila de la base de datos al formato que usa la app.
  // Devuelve null si la fila no es coherente (nunca debería pasar: la base
  // de datos tiene las mismas reglas como restricciones).
  function catalogRowToChallenge(row){
    if(!isObj(row)) return null;
    const id = typeof row.id === "string" && CATALOG_ID.test(row.id) ? row.id : null;
    const text = str(row.text, 400);
    const category = row.category;
    if(!id || !text || !CATEGORY_TYPE[category] || row.duration_type !== CATEGORY_TYPE[category]) return null;
    const points = nonNegInt(row.points, CATEGORY_POINTS[category]);
    if(row.duration_type === "pending") return mkP(id, text, category, points);
    if(row.duration_type === "research"){
      const r = nonNegInt(row.research_seconds, 0), t = nonNegInt(row.talk_seconds, 0);
      if(!r || !t) return null;
      return { id, text, category, durationType:"research", researchDuration:r, talkDuration:t, points };
    }
    const d = nonNegInt(row.duration_seconds, 0);
    if(d < 30) return null;
    return mk(id, text, category, d, points);
  }

  // Filas → lista jugable (solo activas, sin duplicados, en el orden del servidor).
  function normalizeCatalog(rows){
    if(!Array.isArray(rows)) return null;
    const seen = new Set();
    const list = [];
    rows.forEach(row => {
      if(!row || row.active === false) return;
      const c = catalogRowToChallenge(row);
      if(c && !seen.has(c.id)){ seen.add(c.id); list.push(c); }
    });
    return list.length ? list : null;
  }

  // Reto → fila para guardar en la base de datos (panel de administración).
  function challengeToCatalogRow({ id, text, category, durationSeconds }){
    const type = CATEGORY_TYPE[category];
    if(!type) throw new Error("Categoría no válida.");
    const clean = String(text || "").trim().replace(/\s+/g, " ");
    if(clean.length < 6) throw new Error("Escribe un reto un poco más concreto.");
    if(clean.length > 400) throw new Error("El reto es demasiado largo (máximo 400 caracteres).");
    const row = {
      text: clean,
      category,
      duration_type: type,
      duration_seconds: null,
      research_seconds: null,
      talk_seconds: null,
      points: CATEGORY_POINTS[category]
    };
    if(id) row.id = id;
    if(type === "timer"){
      const d = nonNegInt(durationSeconds, 0);
      if(d < 30 || d > 7200) throw new Error("Elige una duración entre 30 segundos y 2 horas.");
      row.duration_seconds = d;
    }
    if(type === "research"){ row.research_seconds = 600; row.talk_seconds = 60; }
    return row;
  }

  function newCatalogId(category, now){
    const t = (now === undefined ? Date.now() : now).toString(36);
    const r = Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, "0");
    return category + "-" + t + r;
  }

  function setCatalog(list){
    catalog = Array.isArray(list) && list.length ? list : DEFAULT_CHALLENGES;
    return catalog;
  }
  function getCatalog(){ return catalog; }

  /* =========================================================
     3. FECHAS Y RACHA (siempre en hora local del dispositivo)
  ========================================================= */
  function pad(n){ return String(n).padStart(2, "0"); }
  function localDateKey(date){
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  // Día anterior por calendario (no restando 24 h, que falla en cambios de hora).
  function previousDateKey(date){
    const d = date instanceof Date ? date : new Date(date);
    return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12));
  }

  // Racha que se debe mostrar: si el último reto fue antes de ayer, la racha ya se rompió.
  function effectiveStreak(data, now){
    const ref = now === undefined ? new Date() : new Date(now);
    if(!data.lastCompletedDate || !data.streak) return 0;
    const today = localDateKey(ref);
    const yesterday = previousDateKey(ref);
    return (data.lastCompletedDate === today || data.lastCompletedDate === yesterday) ? data.streak : 0;
  }

  function totalCompleted(data){
    return STAT_KEYS.reduce((sum, k) => sum + (data.stats[k] || 0), 0);
  }

  /**
   * Registra un reto completado: XP, estadísticas, racha e historial.
   * entry = {id, text, category, points}
   */
  function applyCompletion(data, entry, now){
    const ref = now === undefined ? new Date() : new Date(now);
    const points = nonNegInt(entry.points, 0);
    data.xp += points;
    data.stats[entry.category] = (data.stats[entry.category] || 0) + 1;

    const today = localDateKey(ref);
    if(data.lastCompletedDate !== today){
      const yesterday = previousDateKey(ref);
      data.streak = (data.lastCompletedDate === yesterday) ? data.streak + 1 : 1;
      data.lastCompletedDate = today;
    }

    data.completedLog.unshift({
      id: entry.id,
      text: entry.text,
      category: entry.category,
      completedAt: ref.toISOString(),
      xp: points
    });
    data.completedLog = data.completedLog.slice(0, HISTORY_LIMIT);
    return data;
  }

  /* =========================================================
     4. SORTEO
  ========================================================= */
  function allActiveChallenges(data){
    const defaults = catalog.filter(c => !data.disabledDefaultIds.includes(c.id));
    return defaults.concat(data.customChallenges);
  }

  function poolFor(data, categoryId){
    return allActiveChallenges(data).filter(c => categoryId === "todos" || c.category === categoryId);
  }

  function pickChallenge(data, categoryId, rng){
    const random = rng || Math.random;
    let pool = poolFor(data, categoryId);
    // Un reto de Experiencia ya apuntado como pendiente no puede volver a tocar
    // hasta que lo marques como hecho.
    const pendingIds = data.pendingChallenges.map(a => a.challengeId);
    pool = pool.filter(c => !pendingIds.includes(c.id));
    if(pool.length === 0) return null;
    // Evitar repetición inmediata: descarta los recientes si hay alternativa suficiente.
    const notRecent = pool.filter(c => !data.recentIds.includes(c.id));
    const finalPool = notRecent.length > 0 ? notRecent : pool;
    return finalPool[Math.floor(random() * finalPool.length)];
  }

  function registerRecent(data, id){
    data.recentIds.unshift(id);
    data.recentIds = data.recentIds.slice(0, RECENT_LIMIT);
  }

  /* =========================================================
     5. RETO ACTIVO — la regla "no hay marcha atrás"
     Desde que se pulsa PLAY, el reto elegido queda guardado. Salir,
     recargar o cerrar la app no permite volver a tirar: al volver,
     INERGO te devuelve exactamente a ese reto.
  ========================================================= */
  function snapshot(challenge){
    return normalizeChallengeSnapshot(challenge);
  }

  function createActive(challenge, now){
    return {
      challenge: snapshot(challenge),
      phase: "spinning",
      launchedAt: now === undefined ? Date.now() : now,
      endsAt: null,
      total: null,
      microcopy: null
    };
  }

  function startTimedPhase(active, phase, seconds, now){
    active.phase = phase;
    active.total = seconds;
    active.endsAt = (now === undefined ? Date.now() : now) + seconds * 1000;
    return active;
  }

  function setPhase(active, phase){
    active.phase = phase;
    if(!TIMED_PHASES.includes(phase)){
      active.endsAt = null;
      active.total = null;
    }
    return active;
  }

  function remainingSeconds(endsAt, now){
    const ms = endsAt - (now === undefined ? Date.now() : now);
    return Math.max(0, Math.ceil(ms / 1000));
  }

  // Si un temporizador terminó mientras la app estaba cerrada o en segundo
  // plano, avanza a la fase que corresponde.
  function resolveActive(active, now){
    if(!active || !TIMED_PHASES.includes(active.phase)) return active;
    if(remainingSeconds(active.endsAt, now) > 0) return active;
    return setPhase(active, active.phase === "research" ? "researchDone" : "finished");
  }

  /* =========================================================
     6. COPIA DE SEGURIDAD
  ========================================================= */
  function buildBackup(data, now){
    return {
      app: "INERGO",
      appVersion: APP_VERSION,
      exportedAt: new Date(now === undefined ? Date.now() : now).toISOString(),
      data
    };
  }

  // Lanza Error con mensaje legible si el archivo no es una copia de INERGO.
  function parseBackup(text){
    let json;
    try{ json = JSON.parse(text); }
    catch(e){ throw new Error("El archivo no es una copia válida de INERGO."); }
    if(!isObj(json) || json.app !== "INERGO" || !isObj(json.data)){
      throw new Error("El archivo no es una copia válida de INERGO.");
    }
    return normalizeData(Object.assign({}, json.data, { schemaVersion: SCHEMA_VERSION }));
  }

  return {
    APP_VERSION, STORAGE_KEY, SCHEMA_VERSION,
    CATEGORIES, STAT_KEYS, CUSTOM_CATEGORIES, CUSTOM_DURATIONS, CUSTOM_CHALLENGE_POINTS,
    DEFAULT_CHALLENGES, MICROCOPY, SPIN_PHRASE, HISTORY_LIMIT, RECENT_LIMIT,
    mk, mkP, mkK,
    defaultData, normalizeData,
    localDateKey, previousDateKey, effectiveStreak, totalCompleted, applyCompletion,
    allActiveChallenges, poolFor, pickChallenge, registerRecent,
    createActive, startTimedPhase, setPhase, remainingSeconds, resolveActive, TIMED_PHASES,
    buildBackup, parseBackup, safeId,
    CATEGORY_TYPE, CATEGORY_POINTS,
    catalogRowToChallenge, normalizeCatalog, challengeToCatalogRow, newCatalogId, setCatalog, getCatalog
  };
});
