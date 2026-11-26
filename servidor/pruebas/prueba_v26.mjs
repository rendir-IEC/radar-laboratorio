// Pruebas de la v2.6.0: zona de prácticas (alumnos en papel con variantes y riesgo, rondas, quiebras, curiosidad,
// graduación con Sharpe deflactado que cuenta todas las pruebas, lecciones y vistas).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') +
  '\nexport { aprendizaje, apEstadoNuevo, apPaso, apStats, apSuma, apListaExpertos, apLabValida, prNuevo, prPaso, prFoto, prGraduar, prRonda, prRellena, prLecciones, prT, prClave, PR, AP, H1, VERSION };\n';
const tmp = path.join(os.tmpdir(), 'worker_v26_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);
const { PR, AP, H1 } = W;
const TOTAL = PR.ALUMNOS + PR.ARRIESGADOS;
const bruto = (A) => Object.values(A.pos).reduce((a, b) => a + Math.abs(b), 0);

// azar con semilla para que la prueba sea reproducible
let semilla = 12345;
const azar = () => { semilla = (semilla + 0x6D2B79F5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const normal = () => { const u = Math.max(azar(), 1e-12), v = azar(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

check(/^2\.(6\.[1-9]|([7-9]|\d\d)\.\d+)/.test(W.VERSION), 'versión ' + W.VERSION);

// 1) nacimiento de la zona
const T0 = Date.UTC(2026, 10, 26, 13);
const P0 = W.prNuevo(T0);
const normales0 = P0.alumnos.filter((A) => A.grupo === 'normal'), arriesgados0 = P0.alumnos.filter((A) => A.grupo === 'arriesgado');
check(P0.alumnos.length === TOTAL && normales0.length === 24 && arriesgados0.length === 12, 'nacen ' + normales0.length + ' normales y ' + arriesgados0.length + ' arriesgados');
check(normales0.every((A) => W.apLabValida(A.spec) && [1, 2, 3].includes(A.riesgo) && A.conc == null), 'normales: estrategia válida, riesgo ×1, ×2 o ×3, repartidos');
check(arriesgados0.every((A) => W.apLabValida(A.spec) && [3, 5, 10].includes(A.riesgo) && (A.riesgo >= 5 || A.conc)), 'arriesgados: ×5 o ×10, o ×3 con todo en 1 o 3 monedas: ' + arriesgados0.map((A) => '×' + A.riesgo + (A.conc ? '/' + A.conc : '')).join(' '));
check(arriesgados0.some((A) => A.conc === 1) && arriesgados0.some((A) => A.riesgo === 10), 'hay alguno con todo en 1 moneda y alguno a ×10');
check(new Set(P0.alumnos.map((A) => W.prClave(A.spec, A.riesgo, A.conc))).size === TOTAL, 'ninguno repetido');
const origenes = normales0.reduce((o, A) => ((o[A.origen] = (o[A.origen] || 0) + 1), o), {});
check(origenes.base === 13 && origenes['más riesgo'] >= 4 && origenes.curiosidad >= 3, 'origen: ' + JSON.stringify(origenes));
check(JSON.stringify(W.prNuevo(T0)) === JSON.stringify(P0), 'misma hora, mismos alumnos (reproducible)');

// 2) mercado sintético: un sistema con 800 horas de historia
const mercado = (deriva, vol) => {
  const px = {}; for (const m of AP.MONEDAS) px[m] = 100 * (1 + AP.MONEDAS.indexOf(m));
  const paso = (t) => { const p = {}, f = {}; for (const m of AP.MONEDAS) { px[m] *= Math.exp(paso.deriva(m, t) + vol * normal()); p[m] = px[m]; f[m] = 0.0000125; } return { t, px: p, f }; };
  paso.deriva = deriva;
  return paso;
};
const preparar = (paso, horas, t0) => { const E = W.apEstadoNuevo(); for (let i = 0; i < horas; i++) W.apPaso(E, { ...paso(t0 + i * H1), historia: true }); return E; };
const vivir = (E, P, paso, horas) => {
  let quiebras = 0, retirados = 0, graduados = [];
  for (let i = 0; i < horas; i++) {
    const s = paso(E.t + H1), antes = W.prFoto(E);
    W.apPaso(E, s);
    const o = W.prPaso(E, P, s, antes);
    quiebras += o.quiebras.length; retirados += o.retirados; graduados = graduados.concat(o.graduados);
    if (P.alumnos.length !== TOTAL || P.alumnos.filter((A) => A.grupo === 'arriesgado').length !== PR.ARRIESGADOS) throw new Error('alumnos: ' + P.alumnos.length);
  }
  return { quiebras, retirados, graduados };
};

// 3) mercado sin ventaja (paseo aleatorio): 1.000 horas en vivo
const sinVentaja = mercado(() => 0, 0.006);
let E = preparar(sinVentaja, 800, T0 - 800 * H1);
let P = W.prNuevo(E.t + H1);
let r = vivir(E, P, sinVentaja, 1000);
check(P.rondas === Math.floor(1000 / PR.RONDA_H) - (1000 % PR.RONDA_H === 0 ? 1 : 0) || P.rondas === Math.floor(999 / PR.RONDA_H), 'rondas cada 72 h: ' + P.rondas + ' en 1.000 h');
check(P.alumnos.length === TOTAL && P.probadas === TOTAL + P.cuenta.retirados, 'siempre 24 + 12 alumnos; probados = 36 + retirados (' + P.probadas + ')');
const ga = P.cuenta.grupos.arriesgado || {};
check(ga.retirados > 0 && P.alumnos.filter((A) => A.grupo === 'arriesgado').every((A) => [3, 5, 10].includes(A.riesgo) && (A.riesgo >= 5 || A.conc)), 'los arriesgados compiten aparte y siguen siendo arriesgados: ' + ga.retirados + ' retirados (' + (ga.quiebras || 0) + ' quiebras)');
check(P.cuenta.retirados >= 20, 'se retiran los peores en cada ronda: ' + P.cuenta.retirados + ' retirados (' + P.cuenta.quiebras + ' quiebras)');
check(P.alumnos.some((A) => A.origen === 'hijo') && P.alumnos.some((A) => A.origen === 'curiosidad'), 'nacen hijos de los mejores y alumnos por curiosidad');
check(Math.max(...P.alumnos.map((A) => A.gen)) >= 2, 'hay generaciones: hasta la ' + Math.max(...P.alumnos.map((A) => A.gen)));
check(!r.graduados.length && !(E.graduados || []).length, 'sin ventaja en el mercado, nadie se gradúa');
const bytes = JSON.stringify(P).length;
check(bytes < 120000, 'tamaño del estado: ' + Math.round(bytes / 1024) + ' KB');
check(P.alumnos.every((A) => bruto(A) <= A.riesgo + 1e-9), 'nadie pasa de su riesgo (exposición ≤ su ×)');
const conc = P.alumnos.filter((A) => A.conc && Object.keys(A.pos).length);
check(conc.length > 0 && conc.every((A) => Object.keys(A.pos).length <= A.conc && Math.abs(bruto(A) - A.riesgo) < 1e-9), 'concentrados: como mucho ' + '1 o 3 monedas, con todo su riesgo (' + conc.map((A) => Object.keys(A.pos).length + '×' + A.riesgo).join(' ') + ')');
const L = W.prLecciones(P);
check(L.rows.length >= 10 && L.rows.every((x) => Number.isFinite(x.tMedia) && x.alumnos > 0) && L.frases.every((f) => typeof f === 'string' && !/NaN|undefined/.test(f)), 'lecciones: ' + L.rows.length + ' filas; ' + (L.frases[0] || 'sin frases todavía'));

// 4) cuentas de una hora: lo que gana un alumno es su posición por lo que se movió el precio, menos funding y comisión
{
  const A = P.alumnos.find((x) => Object.keys(x.pos).length);
  const s = sinVentaja(E.t + H1), antes = W.prFoto(E);
  const n0 = A.st.n, log0 = A.st.log, pos = { ...A.pos }, coste = A.coste;
  let esperado = 0; for (const [m, q] of Object.entries(pos)) esperado += q * (s.px[m] / antes.px[m] - 1 - antes.f[m]);
  esperado -= coste;
  W.apPaso(E, s); W.prPaso(E, P, s, antes);
  const vivo = P.alumnos.find((x) => x.id === A.id);
  const ganado = vivo ? vivo.st.log - log0 : null;
  check(vivo && vivo.st.n === n0 + 1 && Math.abs(ganado - Math.log(1 + esperado)) < 1e-12, 'cuentas de una hora exactas (' + (esperado * 100).toFixed(4) + ' %)');
}

// 5) se arruina quien arriesga en una caída fuerte
{
  const alza = mercado(() => 0.0004, 0.002);
  const E2 = preparar(alza, 800, T0 - 800 * H1); // tendencia al alza: los de tendencia compran
  const P2 = W.prNuevo(E2.t + H1);
  vivir(E2, P2, alza, 24);
  const x3 = P2.alumnos.filter((A) => A.riesgo >= 2 && Object.values(A.pos).reduce((a, b) => a + b, 0) > 1).length;
  alza.deriva = () => -0.03;
  const r2 = vivir(E2, P2, alza, 30); // caída del ~60 % en 30 horas
  check(x3 > 0 && r2.quiebras > 0 && P2.retirados.some((x) => x.motivo === 'quiebra' && x.riesgo >= 2), 'caída fuerte: quiebran ' + r2.quiebras + ' (había ' + x3 + ' comprados con ×2 o más)');
  check(P2.retirados.some((x) => x.motivo === 'quiebra' && x.grupo === 'arriesgado'), 'quiebran arriesgados: ' + P2.retirados.filter((x) => x.motivo === 'quiebra' && x.grupo === 'arriesgado').map((x) => x.alumno).slice(0, 3).join(' | '));
  check(P2.alumnos.length === TOTAL, 'las plazas de los quebrados se vuelven a ocupar');
  const L2 = W.prLecciones(P2);
  check(L2.rows.some((x) => x.aspecto === 'Riesgo' && x.quiebras > 0), 'la lección queda: quiebras por nivel de riesgo');
}

// 6) graduación: solo con ventaja real y contando todas las pruebas
const conStats = (P, f) => { for (const A of P.alumnos) { A.st = W.apStats(); for (let i = 0; i < 800; i++) W.apSuma(A.st, f(A, i)); } };
{
  const E3 = W.apEstadoNuevo(); E3.monedas = {};
  const P3 = W.prNuevo(T0);
  conStats(P3, () => 0.01 * normal());
  check(!W.prGraduar(E3, P3, T0 + 800 * H1).length, 'todos sin ventaja (800 h de ruido): ninguno se gradúa');
  const P4 = W.prNuevo(T0);
  const elegido = P4.alumnos[2];
  conStats(P4, (A) => (A === elegido ? 0.003 : 0) + 0.01 * normal());
  const g = W.prGraduar(E3, P4, T0 + 800 * H1);
  check(g.length === 1 && elegido.graduado && elegido.dsr > 0.95, 'uno gana de verdad (t ≈ 8): se gradúa con Sharpe deflactado ' + (elegido.dsr || 0).toFixed(3));
  check(E3.graduados && E3.graduados.length === 1 && W.apListaExpertos(E3).some((ex) => ex.id === E3.graduados[0].id && ex.tipo === 'lab' && ex.aprobadaLab === false), 'entra a competir en el sistema como candidata (poco peso)');
  check(!W.prGraduar(E3, P4, T0 + 801 * H1).length, 'no se gradúa dos veces');
  const P5 = W.prNuevo(T0);
  conStats(P5, (A) => (A === P5.alumnos[2] ? 0.003 : 0) + 0.01 * normal());
  P5.probadas = 1e7;
  const g5 = W.prGraduar(W.apEstadoNuevo(), P5, T0 + 800 * H1);
  check(P5.alumnos[2].dsr < P4.alumnos[2].dsr, 'con muchas más pruebas el listón sube (' + P5.alumnos[2].dsr.toFixed(3) + ' < ' + elegido.dsr.toFixed(3) + ')');
  // la ronda no retira a un graduado
  const P6 = W.prNuevo(T0);
  conStats(P6, (A, i) => (A === P6.alumnos[0] ? -0.003 : 0) + 0.01 * normal());
  P6.alumnos[0].graduado = T0;
  W.prRonda(P6, T0 + 800 * H1);
  check(P6.alumnos.some((A) => A.id === 'p1') && P6.cuenta.retirados >= 1, 'la ronda retira a los peores pero no a un graduado');
}

// 7) el sistema sigue funcionando con un graduado dentro
{
  const E7 = preparar(sinVentaja, 800, T0 - 800 * H1);
  const P7 = W.prNuevo(E7.t + H1);
  E7.graduados = [{ id: 'grad_' + 'cruce_24_168_s_ser_amb_nf_h1', nombre: 'Tendencia 1 día / 1 semana', spec: P7.alumnos[1].spec, t: E7.t }];
  vivir(E7, P7, sinVentaja, 5);
  check(E7.expertos[E7.graduados[0].id] && E7.expertos[E7.graduados[0].id].activo, 'el graduado aprende en el sistema como un experto más');
}

// 7b) paso de la v2.6.0 (24 alumnos sin grupo) a la v2.6.1: nace el grupo arriesgado sin tocar a los de antes
{
  const E8 = preparar(sinVentaja, 800, T0 - 800 * H1);
  const P8 = W.prNuevo(E8.t + H1);
  P8.alumnos = P8.alumnos.filter((A) => A.grupo === 'normal').map((A) => { const B = { ...A }; delete B.grupo; delete B.conc; return B; });
  P8.v = 1; P8.probadas = 24;
  const antes8 = P8.alumnos.map((A) => A.id).join();
  vivir(E8, P8, sinVentaja, 3);
  check(P8.v === 2 && P8.alumnos.filter((A) => A.grupo === 'normal').map((A) => A.id).join() === antes8 && P8.alumnos.filter((A) => A.grupo === 'arriesgado').length === 12 && P8.probadas === 36, 'migración: los 24 de antes siguen igual y nacen 12 arriesgados');
}

// 8) vistas, con la base de datos
const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { db.prepare(sql).run(...args); return { success: true }; }, _run: () => db.prepare(sql).run(...args) });
const ENV = { DB: { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } } };
let v = await W.aprendizaje({ vista: 'practicas' }, ENV);
check(v.rows.length === 0 && /próxima hora/.test(v.nota), 'antes de abrir: la vista lo explica');
db.prepare("INSERT INTO ap_estado (id, json, t) VALUES ('practicas', ?, ?)").run(JSON.stringify(P), P.t);
v = await W.aprendizaje({ vista: 'practicas' }, ENV);
check(v.rows.length === TOTAL && v.rows.every((x) => typeof x.alumno === 'string' && /×(1|2|3|5|10)$/.test(x.alumno) && ['normal', 'arriesgado'].includes(x.grupo) && Number.isFinite(x.rentPct) && Number.isFinite(x.tStat) && x.estado), 'vista practicas: ' + v.rows[0].alumno + ', ' + v.rows[0].horas + ' h, t ' + v.rows[0].tStat.toFixed(2) + ' (' + v.rows[0].estado + ')');
check(v.resumen.arriesgados === 12 && v.resumen.probadas === P.probadas && v.resumen.rondas === P.rondas && /^\d{4}-/.test(v.resumen.proximaRonda), 'resumen: ' + JSON.stringify({ probadas: v.resumen.probadas, rondas: v.resumen.rondas, retirados: v.resumen.retirados, quiebras: v.resumen.quiebras }));
const vr = await W.aprendizaje({ vista: 'practicas_retirados' }, ENV);
check(vr.rows.length > 0 && vr.rows.every((x) => /^(Quebró|Retirado)/.test(x.motivo) && x.spec === undefined), 'vista practicas_retirados: ' + vr.rows[0].alumno + ' — ' + vr.rows[0].motivo);
const vl = await W.aprendizaje({ vista: 'practicas_lecciones' }, ENV);
check(vl.rows.length >= 10 && Array.isArray(vl.frases), 'vista practicas_lecciones: ' + vl.rows.length + ' filas');
check(!JSON.stringify([v, vr, vl]).includes('NaN'), 'sin NaN en las vistas');

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
