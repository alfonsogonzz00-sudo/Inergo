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
  assert.deepEqual(d.disabledDefaultIds, ["espontanea-001"]);
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
