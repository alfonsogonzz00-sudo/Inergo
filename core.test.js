/* Tests de la lógica crítica de INERGO.
   Ejecutar:  node --test tests/
   (sin dependencias; Node 18 o superior) */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/inergo-core.js");

function fresh(){ return C.defaultData(); }
// Generador pseudoaleatorio fijo para que los sorteos sean reproducibles.
function seq(...values){ let i = 0; return () => values[i++ % values.length]; }

test("el catálogo predeterminado se conserva íntegro (103 retos)", () => {
  const by = {};
  C.DEFAULT_CHALLENGES.forEach(c => { by[c.category] = (by[c.category] || 0) + 1; });
  assert.equal(C.DEFAULT_CHALLENGES.length, 103);
  assert.deepEqual(by, { espontanea:13, experiencia:10, reflexion:20, conocimiento:60 });
  const ids = new Set(C.DEFAULT_CHALLENGES.map(c => c.id));
  assert.equal(ids.size, 103, "ids únicos");
});

test("XP fijos por categoría", () => {
  const xp = {};
  C.DEFAULT_CHALLENGES.forEach(c => { xp[c.category] = c.points; });
  assert.deepEqual(xp, { espontanea:20, experiencia:50, reflexion:15, conocimiento:20 });
});

test("tipos de reto según categoría", () => {
  C.DEFAULT_CHALLENGES.forEach(c => {
    if(c.category === "experiencia") assert.equal(c.durationType, "pending");
    else if(c.category === "conocimiento"){
      assert.equal(c.durationType, "research");
      assert.equal(c.researchDuration, 600);
      assert.equal(c.talkDuration, 60);
    }else assert.equal(c.durationType, "timer");
  });
});

test("sorteo: filtra por categoría", () => {
  const d = fresh();
  for(let i = 0; i < 50; i++){
    const c = C.pickChallenge(d, "reflexion");
    assert.equal(c.category, "reflexion");
  }
});

test("sorteo: excluye retos desactivados y pendientes", () => {
  const d = fresh();
  const exp = C.DEFAULT_CHALLENGES.filter(c => c.category === "experiencia");
  d.disabledDefaultIds = exp.slice(0, 5).map(c => c.id);
  d.pendingChallenges = exp.slice(5, 9).map((c, i) => ({ activeId:"pending-" + i, challengeId:c.id, text:c.text, category:c.category, points:50, savedAt:1 }));
  for(let i = 0; i < 30; i++){
    assert.equal(C.pickChallenge(d, "experiencia").id, exp[9].id);
  }
  d.pendingChallenges.push({ activeId:"pending-x", challengeId:exp[9].id, text:"x", category:"experiencia", points:50, savedAt:1 });
  assert.equal(C.pickChallenge(d, "experiencia"), null);
});

test("sorteo: evita repetición inmediata si hay alternativa", () => {
  const d = fresh();
  const esp = C.DEFAULT_CHALLENGES.filter(c => c.category === "espontanea");
  d.recentIds = esp.slice(0, 6).map(c => c.id);
  for(let i = 0; i < 100; i++){
    assert.ok(!d.recentIds.includes(C.pickChallenge(d, "espontanea").id));
  }
});

test("sorteo: incluye retos personalizados", () => {
  const d = fresh();
  d.disabledDefaultIds = C.DEFAULT_CHALLENGES.map(c => c.id);
  d.customChallenges.push(C.mk("custom-1", "Mi reto", "espontanea", 300, 25));
  assert.equal(C.pickChallenge(d, "todos").id, "custom-1");
});

test("recientes: máximo 6", () => {
  const d = fresh();
  for(let i = 0; i < 10; i++) C.registerRecent(d, "r" + i);
  assert.deepEqual(d.recentIds, ["r9","r8","r7","r6","r5","r4"]);
});

test("racha: usa la fecha local, no UTC", () => {
  // 00:30 hora local del 10 de marzo: en UTC podría seguir siendo día 9.
  const d = fresh();
  C.applyCompletion(d, { id:"a", text:"a", category:"espontanea", points:20 }, new Date(2026, 2, 9, 21, 0));
  C.applyCompletion(d, { id:"b", text:"b", category:"espontanea", points:20 }, new Date(2026, 2, 10, 0, 30));
  assert.equal(d.streak, 2);
  assert.equal(d.lastCompletedDate, "2026-03-10");
});

test("racha: mismo día no suma, día siguiente suma, hueco reinicia", () => {
  const d = fresh();
  const done = (date) => C.applyCompletion(d, { id:"x", text:"x", category:"reflexion", points:15 }, date);
  done(new Date(2026, 9, 1, 10));
  done(new Date(2026, 9, 1, 22));
  assert.equal(d.streak, 1);
  done(new Date(2026, 9, 2, 9));
  assert.equal(d.streak, 2);
  done(new Date(2026, 9, 4, 9));
  assert.equal(d.streak, 1);
});

test("racha: cruza el cambio de hora de octubre", () => {
  const d = fresh();
  const done = (date) => C.applyCompletion(d, { id:"x", text:"x", category:"reflexion", points:15 }, date);
  done(new Date(2026, 9, 24, 23, 50));
  done(new Date(2026, 9, 25, 23, 50)); // 25 oct 2026: se atrasa el reloj en Europa
  done(new Date(2026, 9, 26, 0, 10));
  assert.equal(d.streak, 3);
});

test("racha visible: se rompe si pasa más de un día sin retos", () => {
  const d = fresh();
  d.streak = 5; d.lastCompletedDate = "2026-10-05";
  assert.equal(C.effectiveStreak(d, new Date(2026, 9, 5, 20)), 5);
  assert.equal(C.effectiveStreak(d, new Date(2026, 9, 6, 20)), 5);
  assert.equal(C.effectiveStreak(d, new Date(2026, 9, 7, 8)), 0);
});

test("total de retos no se queda clavado en el límite del historial", () => {
  const d = fresh();
  for(let i = 0; i < 55; i++){
    C.applyCompletion(d, { id:"x" + i, text:"x", category:"espontanea", points:20 }, new Date(2026, 0, 1 + i));
  }
  assert.equal(d.completedLog.length, 40);
  assert.equal(C.totalCompleted(d), 55);
  assert.equal(d.xp, 55 * 20);
});

test("reto activo: el temporizador sigue aunque la app esté cerrada", () => {
  const c = C.DEFAULT_CHALLENGES.find(x => x.id === "espontanea-002");
  const t0 = 1_000_000;
  const a = C.createActive(c, t0);
  assert.equal(a.phase, "spinning");
  C.setPhase(a, "revealed");
  C.startTimedPhase(a, "timer", c.duration, t0);
  assert.equal(C.remainingSeconds(a.endsAt, t0 + 1), c.duration);
  assert.equal(C.remainingSeconds(a.endsAt, t0 + 120_000), c.duration - 120);
  C.resolveActive(a, t0 + 60_000);
  assert.equal(a.phase, "timer");
  C.resolveActive(a, t0 + c.duration * 1000 + 5);
  assert.equal(a.phase, "finished");
  assert.equal(a.endsAt, null);
});

test("reto activo: Conocimiento pasa de investigar a hablar", () => {
  const c = C.DEFAULT_CHALLENGES.find(x => x.category === "conocimiento");
  const a = C.createActive(c, 0);
  C.startTimedPhase(a, "research", c.researchDuration, 0);
  C.resolveActive(a, 600_001);
  assert.equal(a.phase, "researchDone");
  C.startTimedPhase(a, "talk", c.talkDuration, 700_000);
  C.resolveActive(a, 760_001);
  assert.equal(a.phase, "finished");
});

test("reto activo: sobrevive a guardar y cargar", () => {
  const d = fresh();
  const c = C.DEFAULT_CHALLENGES[0];
  d.activeChallenge = C.startTimedPhase(C.createActive(c, 5), "timer", 900, 10);
  const back = C.normalizeData(JSON.parse(JSON.stringify(d)));
  assert.equal(back.activeChallenge.challenge.id, c.id);
  assert.equal(back.activeChallenge.phase, "timer");
  assert.equal(back.activeChallenge.endsAt, 10 + 900_000);
});

test("migración: datos de la versión anterior se conservan", () => {
  const legacy = {
    customChallenges: [{ id:"custom-1700000000000", text:"Reto propio", category:"reflexion", durationType:"timer", duration:600, points:25 }],
    disabledDefaultIds: ["espontanea-001", "no-existe"],
    completedLog: [{ id:"espontanea-002", text:"Pide un descuento", category:"espontanea", completedAt:"2026-10-01T10:00:00.000Z", xp:20 }],
    recentIds: ["espontanea-002"],
    pendingChallenges: [{ activeId:"pending-1-2", challengeId:"experiencia-001", text:"Cena solo", category:"experiencia", points:50, savedAt:1700000000000 }],
    mirrorMode: true, xp: 70, streak: 3, lastCompletedDate: "2026-10-01",
    stats: { espontanea:1, experiencia:1, reflexion:0, conocimiento:0 },
    selectedCategory: "reflexion"
  };
  const d = C.normalizeData(legacy);
  assert.equal(d.customChallenges.length, 1);
  assert.equal(d.customChallenges[0].duration, 600);
  // Se conservan aunque no estén en los 103 de serie: el catálogo remoto puede tener más.
  assert.deepEqual(d.disabledDefaultIds, ["espontanea-001", "no-existe"]);
  assert.equal(d.completedLog.length, 1);
  assert.equal(d.pendingChallenges.length, 1);
  assert.equal(d.mirrorMode, true);
  assert.equal(d.xp, 70);
  assert.equal(d.streak, 3);
  assert.equal(d.selectedCategory, "reflexion");
  assert.equal(d.onboardingDone, true, "quien ya usaba la app no ve la introducción");
  assert.equal(d.soundOn, true);
  assert.equal(d.activeChallenge, null);
});

test("migración: categoría fantasma vuelve a TODOS", () => {
  assert.equal(C.normalizeData({ selectedCategory:"habito" }).selectedCategory, "todos");
});

test("usuario nuevo ve la introducción", () => {
  assert.equal(C.normalizeData(null).onboardingDone, false);
  assert.equal(C.defaultData().onboardingDone, false);
});

test("importar: rechaza archivos que no son de INERGO", () => {
  assert.throws(() => C.parseBackup("hola"), /no es una copia válida/);
  assert.throws(() => C.parseBackup(JSON.stringify({ data:{} })), /no es una copia válida/);
});

test("importar: neutraliza ids y textos manipulados", () => {
  const evil = {
    app:"INERGO",
    data:{
      customChallenges:[
        { id:'x" onmouseover="alert(1)', text:"<img src=x onerror=alert(1)>", category:"espontanea", duration:300 },
        { id:"custom-2", text:"  ", category:"espontanea", duration:300 },
        { id:"custom-3", text:"Válido", category:"conocimiento", duration:99999 }
      ],
      xp:-50, streak:"muchos", stats:{ espontanea:"3" }
    }
  };
  const d = C.parseBackup(JSON.stringify(evil));
  assert.equal(d.customChallenges.length, 1);
  assert.equal(d.customChallenges[0].id, "custom-3");
  assert.equal(d.customChallenges[0].category, "espontanea", "Conocimiento no se permite en retos propios");
  assert.equal(d.customChallenges[0].duration, 300);
  assert.equal(d.xp, 0);
  assert.equal(d.streak, 0);
  assert.equal(d.stats.espontanea, 3);
});

test("copia de seguridad: ida y vuelta sin pérdidas", () => {
  const d = fresh();
  d.onboardingDone = true;
  C.applyCompletion(d, { id:"reflexion-001", text:"t", category:"reflexion", points:15 }, new Date(2026, 9, 8, 12));
  d.customChallenges.push(C.mk("custom-9", "Otro", "experiencia", 1800, 25));
  const back = C.parseBackup(JSON.stringify(C.buildBackup(d, 0)));
  assert.deepEqual(back, d);
});

test("modo pruebas: desactivado por defecto y se conserva al guardar", () => {
  assert.equal(C.defaultData().testMode, false);
  assert.equal(C.normalizeData({}).testMode, false);
  assert.equal(C.normalizeData({ schemaVersion:2, testMode:true }).testMode, true);
  assert.equal(C.normalizeData({ testMode:"sí" }).testMode, false);
});

/* ---------- Catálogo remoto (Supabase) ---------- */
const row = (o) => Object.assign({ id:"espontanea-zz", text:"Reto remoto de prueba", category:"espontanea", duration_type:"timer",
  duration_seconds:300, research_seconds:null, talk_seconds:null, points:20, active:true, sort_order:1 }, o);

test("catálogo: convierte filas de la base de datos al formato de la app", () => {
  const list = C.normalizeCatalog([
    row({}),
    row({ id:"experiencia-zz", category:"experiencia", duration_type:"pending", duration_seconds:null, points:50 }),
    row({ id:"conocimiento-zz", category:"conocimiento", duration_type:"research", duration_seconds:null, research_seconds:600, talk_seconds:60 })
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], C.mk("espontanea-zz", "Reto remoto de prueba", "espontanea", 300, 20));
  assert.equal(list[1].durationType, "pending");
  assert.equal(list[2].durationType, "research");
  assert.equal(list[2].researchDuration, 600);
});

test("catálogo: descarta filas inactivas, incoherentes o duplicadas", () => {
  const list = C.normalizeCatalog([
    row({}),
    row({}),                                                       // duplicada
    row({ id:"x-inactivo", active:false }),
    row({ id:"experiencia-mal", category:"experiencia" }),          // Experiencia con cronómetro
    row({ id:"Mal Id", text:"Id con mayúsculas y espacios" }),
    row({ id:"vacio-1", text:"   " }),
    null, "basura"
  ]);
  assert.deepEqual(list.map(c => c.id), ["espontanea-zz"]);
  assert.equal(C.normalizeCatalog([]), null, "lista vacía → se queda el catálogo de serie");
  assert.equal(C.normalizeCatalog("no"), null);
});

test("catálogo: el sorteo usa el catálogo activo y vuelve al de serie si se vacía", () => {
  const d = C.defaultData();
  C.setCatalog(C.normalizeCatalog([row({})]));
  assert.equal(C.pickChallenge(d, "todos").id, "espontanea-zz");
  assert.equal(C.poolFor(d, "reflexion").length, 0);
  C.setCatalog(null);
  assert.equal(C.getCatalog().length, 103);
  assert.equal(C.poolFor(d, "todos").length, 103);
});

test("panel: prepara filas válidas para la base de datos", () => {
  const t = C.challengeToCatalogRow({ text:"  Habla   con 3 desconocidos ", category:"espontanea", durationSeconds:600 });
  assert.deepEqual(t, { text:"Habla con 3 desconocidos", category:"espontanea", duration_type:"timer", duration_seconds:600, research_seconds:null, talk_seconds:null, points:20 });
  const e = C.challengeToCatalogRow({ text:"Cena solo en un restaurante", category:"experiencia" });
  assert.equal(e.duration_type, "pending"); assert.equal(e.duration_seconds, null); assert.equal(e.points, 50);
  const k = C.challengeToCatalogRow({ text:"Investiga qué es la sinestesia", category:"conocimiento" });
  assert.equal(k.research_seconds, 600); assert.equal(k.talk_seconds, 60);
  assert.throws(() => C.challengeToCatalogRow({ text:"corto", category:"espontanea", durationSeconds:300 }), /concreto/);
  assert.throws(() => C.challengeToCatalogRow({ text:"Reto sin tiempo válido", category:"reflexion", durationSeconds:5 }), /duración/);
  assert.throws(() => C.challengeToCatalogRow({ text:"Categoría inventada", category:"habito" }), /Categoría/);
  // Lo que genera el panel lo acepta el lector del catálogo (mismas reglas que la base de datos)
  const id = C.newCatalogId("espontanea", 1700000000000);
  assert.match(id, /^[a-z0-9-]{1,80}$/);
  assert.ok(C.catalogRowToChallenge(Object.assign({ id, active:true }, t)));
});
