// Pruebas de la v2.10.0: examen de entrada de la zona de prácticas. Un alumno nuevo solo nace si su idea, con su
// riesgo, aprueba en la tabla del laboratorio (resultados/examen.json); sin tabla, como antes. Lectura y refresco de
// la tabla (cada 6 h en el minuto del laboratorio) y lo que enseña la vista.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') +
  '\nexport { aprendizaje, prSugeridas, apEstadoNuevo, prFoto, prPaso, prFaltan, prNuevo, prRellena, prRetira, prExamen, prClave, exLeer, exActualizar, exValido, apLabIdent, PR, H1, VERSION, EX_URL };\n';
const tmp = path.join(os.tmpdir(), 'worker_v210_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);
const { PR, H1 } = W;
const RIESGOS = [1, 2, 3, 5, 10];

check(/^2\.(1\d|[2-9]\d)\.\d+/.test(W.VERSION) || /^[3-9]\./.test(W.VERSION), 'versión ' + W.VERSION);

// tabla sintética: aprueban solo las ideas «solo compras» y, con ×10, ninguna
const regla = (ident) => {
  const largos = ident.includes('_lar_');
  let mask = 0;
  RIESGOS.forEach((r, i) => { if (largos && r < 10) mask |= 1 << i; });
  return [mask, ...RIESGOS.map((r) => (largos ? 5 * r : -3 * r))];
};
const ideas = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? regla(k) : undefined) });
const X = { generado: '2026-11-28T12:00:00Z', ventana: { desde: '2024-11-28', hasta: '2026-11-28' }, riesgos: RIESGOS, ideas };

const larga = { senal: 'cruce', a: 24, b: 168, forma: 'signo', modo: 'serie', lado: 'largos', filtro: 'ninguno', cada: 1 };
const ambos = { ...larga, lado: 'ambos' };
let e = W.prExamen(X, larga, 2);
check(e.ok && e.rentPct === 10, 'idea que aprueba con ×2: ' + JSON.stringify(e));
check(!W.prExamen(X, larga, 10).ok, 'la misma con ×10 suspende');
check(!W.prExamen(X, ambos, 1).ok, 'una idea que pierde suspende');
check(!W.prExamen(X, larga, 4).ok, 'un riesgo que no está en la tabla no aprueba');
check(!W.prExamen({ ...X, ideas: {} }, larga, 1).ok, 'una idea que no está en la tabla no aprueba');
check(W.prExamen(null, ambos, 10).ok && W.prExamen(null, ambos, 10).sin, 'sin tabla: sin examen (como antes)');
// v2.10.1: los concentrados tienen su propio examen
const Xc = { ...X, ideas: { [W.apLabIdent(larga)]: [31, 1, 2, 3, 5, 10], [W.apLabIdent(larga) + '_c1']: [0, -50, -80, -95, -99, -100], [W.apLabIdent(larga) + '_c3']: [7, 4, 6, 8, -40, -90] } };
check(W.prExamen(Xc, larga, 5).ok && !W.prExamen(Xc, larga, 5, 1).ok, 'repartida aprueba con ×5; todo en 1 moneda suspende');
check(W.prExamen(Xc, larga, 3, 3).ok && W.prExamen(Xc, larga, 3, 3).rentPct === 8 && !W.prExamen(Xc, larga, 5, 3).ok, 'en 3 monedas: aprueba con ×3 (8 %) y suspende con ×5');
const Xviejo = { ...X, ideas: { [W.apLabIdent(larga)]: [31, 1, 2, 3, 5, 10] } };
check(W.prExamen(Xviejo, larga, 5, 1).ok, 'con una tabla sin concentrados, se usa la idea repartida');

// rellenar plazas con examen
const T0 = Date.UTC(2026, 10, 28, 12);
const P = W.prNuevo(T0);
const total = P.alumnos.length;
const fuera = P.alumnos.filter((A) => A.origen !== 'base' && A.grupo === 'normal').slice(0, 7).concat(P.alumnos.filter((A) => A.grupo === 'arriesgado').slice(0, 3));
for (const A of fuera) W.prRetira(P, A, T0 + H1, 'ronda');
check(P.alumnos.length === total - 10, 'se retiran 10');
W.prRellena(P, T0 + H1, X);
const nuevos = P.alumnos.filter((A) => A.nace === T0 + H1);
const normalesNuevos = nuevos.filter((A) => A.grupo === 'normal'), arrNuevos = nuevos.filter((A) => A.grupo === 'arriesgado');
check(normalesNuevos.length > 0 && normalesNuevos.every((A) => A.spec.lado === 'largos' && A.riesgo < 10 && A.examenPct === 5 * A.riesgo), 'los normales nuevos aprueban: todos «solo compras», con su nota (' + normalesNuevos.map((A) => '×' + A.riesgo + ' ' + A.examenPct + ' %').join(', ') + ')');
check(arrNuevos.length === 3 && arrNuevos.every((A) => A.spec.lado === 'largos' && A.riesgo < 10), 'los arriesgados nuevos también: ninguno a ×10 (' + arrNuevos.map((A) => '×' + A.riesgo + (A.conc ? '/' + A.conc : '')).join(', ') + ')');
check(P.cuenta.suspendidos > 0 && P.cuenta.aprobados === nuevos.length, 'suspendidas ' + P.cuenta.suspendidos + ' ideas; aprobadas ' + P.cuenta.aprobados);
check(P.alumnos.length === total, 'se llenan todas las plazas: ' + P.alumnos.length);
check(new Set(P.alumnos.map((A) => W.prClave(A.spec, A.riesgo, A.conc))).size === P.alumnos.length, 'ninguno repetido');

// si no aprueba nada, las plazas se quedan vacías y no se rompe nada
const nada = { ...X, ideas: new Proxy({}, { get: () => [0, -1, -2, -3, -5, -10] }) };
const P2 = W.prNuevo(T0);
for (const A of P2.alumnos.filter((A) => A.origen !== 'base').slice(0, 5)) W.prRetira(P2, A, T0 + H1, 'ronda');
W.prRellena(P2, T0 + H1, nada);
check(P2.alumnos.length === total - 5 && P2.cuenta.suspendidos > 100, 'si ninguna idea aprueba, las plazas esperan: ' + P2.alumnos.length + ' alumnos, ' + P2.cuenta.suspendidos + ' suspendidas');
// sin tabla, como antes
const P3 = W.prNuevo(T0);
for (const A of P3.alumnos.filter((A) => A.origen !== 'base').slice(0, 5)) W.prRetira(P3, A, T0 + H1, 'ronda');
W.prRellena(P3, T0 + H1, null);
check(P3.alumnos.length === total && !P3.cuenta.suspendidos && P3.alumnos.every((A) => A.examenPct == null), 'sin tabla nacen como antes, sin nota');

// en la hora en vivo: sin plazas libres no se lee la tabla (false); las que se vacían se llenan la hora siguiente
const E = W.apEstadoNuevo(); E.t = T0;
const P4 = W.prNuevo(T0);
check(!W.prFaltan(P4), 'con todas las plazas llenas no hace falta leer la tabla');
W.prRetira(P4, P4.alumnos.find((A) => A.origen !== 'base'), T0 + H1, 'ronda');
check(W.prFaltan(P4), 'con una plaza libre, sí');
W.prPaso(E, P4, { t: T0 + H1, px: {} }, W.prFoto(E), false);
check(P4.alumnos.length === total - 1, 'si no se ha leído la tabla (false), la plaza espera a la hora siguiente');
W.prPaso(E, P4, { t: T0 + 2 * H1, px: {} }, W.prFoto(E), X);
check(P4.alumnos.length === total && P4.alumnos.some((A) => A.examenPct != null), 'la hora siguiente, con la tabla, se llena con un alumno que aprueba');

// v2.11.0: ideas sugeridas por el laboratorio en el grupo arriesgado
const sug = [{ spec: { senal: 'funding_contra', a: 168, forma: 'signo', modo: 'seccion', lado: 'largos', filtro: 'btc_alcista', cada: 24 }, riesgo: 5, conc: null, motivo: 'prueba' },
  { spec: { senal: 'funding_contra', a: 24, forma: 'signo', modo: 'seccion', lado: 'largos', filtro: 'btc_alcista', cada: 1 }, riesgo: 5, conc: null },
  { spec: { senal: 'funding_contra', a: 24, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, riesgo: 5, conc: 1 },
  { spec: { senal: 'funding_contra', a: 168, forma: 'signo', modo: 'serie', lado: 'largos', filtro: 'ninguno', cada: 1 }, riesgo: 10, conc: null }];
const Xs = { ...X, sugeridas: sug };
const P5 = W.prNuevo(T0);
const arr5 = P5.alumnos.filter((A) => A.grupo === 'arriesgado');
for (const A of arr5.slice(0, 4)) W.prRetira(P5, A, T0 + H1, 'ronda');
W.prRellena(P5, T0 + H1, Xs);
const lab5 = P5.alumnos.filter((A) => A.origen === 'laboratorio');
check(lab5.length === 2 && lab5.every((A) => A.grupo === 'arriesgado' && A.riesgo === 5 && A.spec.lado === 'largos' && A.examenPct === 25), 'entran las 2 sugeridas que aprueban (las «solo compras» de la tabla de prueba): ' + lab5.map((A) => A.spec.a + 'h ×' + A.riesgo).join(', '));
check(P5.alumnos.length === total && P5.alumnos.filter((A) => A.grupo === 'arriesgado').length === 12, 'y el resto de plazas se llena como siempre');
check(P5.sugeridasProbadas.length === 2, 'quedan apuntadas como probadas');
for (const A of lab5) W.prRetira(P5, A, T0 + 2 * H1, 'ronda');
W.prRellena(P5, T0 + 2 * H1, Xs);
check(!P5.alumnos.some((A) => A.origen === 'laboratorio'), 'si se retiran, no vuelven a entrar (cada sugerida una sola vez)');
const P6 = W.prNuevo(T0);
for (const A of P6.alumnos.filter((A) => A.grupo === 'arriesgado').slice(0, 6)) W.prRetira(P6, A, T0 + H1, 'ronda');
const Xmuchas = { ...X, ideas: new Proxy({}, { get: () => [31, 1, 2, 3, 5, 10] }), sugeridas: [3, 4, 5, 6, 7].map((h) => ({ spec: { senal: 'cruce', a: 24, b: 168, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: h % 2 ? 1 : 24 }, riesgo: h < 5 ? 5 : 10, conc: null })) };
W.prRellena(P6, T0 + H1, Xmuchas);
check(P6.alumnos.filter((A) => A.origen === 'laboratorio').length === 3, 'como mucho 3 sugeridas a la vez');

// tabla en D1: validación, refresco cada 6 h y vista
check(!W.exValido(null) && !W.exValido({ version: 1, riesgos: RIESGOS, ideas: { a: [1] }, ventana: {} }), 'una tabla vacía o pequeña no vale');
const tabla = { version: 1, generado: '2026-11-28T12:00:00Z', ventana: { desde: '2024-11-28', hasta: '2026-11-28', dias: 730 }, riesgos: RIESGOS, resumen: { ideas: 4608, aprueban: { x1: 900 } }, coste_por_giro_pct: 0.07, ideas: {},
  sugeridas: [{ spec: larga, riesgo: 5, conc: null, motivo: 'prueba', dos_anos: { rent_pct: 40, caida_max_pct: 30 }, toda_la_historia: { quiebra: false } }, { spec: { senal: 'nada' }, riesgo: 5 }] };
for (let i = 0; i < 1200; i++) tabla.ideas['idea_' + i] = [1, 1, 2, 3, 5, 10];
tabla.ideas[W.apLabIdent(larga)] = [15, 4, 8, 12, 20, -60];
check(W.exValido(tabla), 'la tabla del laboratorio vale');
const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { db.prepare(sql).run(...args); return { success: true }; }, _run: () => db.prepare(sql).run(...args) });
const ENV = { DB: { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } } };
db.exec('CREATE TABLE ap_estado (id TEXT PRIMARY KEY, json TEXT NOT NULL, t INTEGER)');
let pedidas = 0;
globalThis.fetch = async (url) => { pedidas++; if (url !== W.EX_URL) throw new Error('url ' + url); return { ok: true, json: async () => tabla }; };
const ahora = Date.UTC(2026, 10, 28, 12, 37);
check(await W.exActualizar(ENV, ahora) === true && pedidas === 1, 'primera lectura de la tabla');
const L = await W.exLeer(ENV);
check(L && L.generado === tabla.generado && Object.keys(L.ideas).length === 1201 && L.riesgos.length === 5, 'guardada en D1 (' + JSON.stringify(L).length + ' bytes)');
check(L.sugeridas.length === 1 && L.sugeridas[0].dosAnos.rent_pct === 40, 'guarda las sugeridas válidas (descarta las que no son ideas)');
check(await W.exActualizar(ENV, ahora + 3 * H1) === false && pedidas === 1, 'a las 3 h no se vuelve a pedir');
check(await W.exActualizar(ENV, ahora + 7 * H1) === true && pedidas === 2, 'a las 7 h sí');
globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1, riesgos: [], ideas: {} }) });
check(await W.exActualizar(ENV, ahora + 14 * H1) === false && (await W.exLeer(ENV)).generado === tabla.generado, 'una tabla rota no sustituye a la buena');
// vista
P.t = T0 + H1;
db.prepare("INSERT INTO ap_estado (id, json, t) VALUES ('practicas', ?, ?)").run(JSON.stringify(P), P.t);
const v = await W.aprendizaje({ vista: 'practicas' }, ENV);
check(v.resumen.suspendidos === P.cuenta.suspendidos && v.resumen.aprobados === P.cuenta.aprobados && v.resumen.examen && v.resumen.examen.desde === '2024-11-28', 'la vista enseña el examen: ' + JSON.stringify({ s: v.resumen.suspendidos, a: v.resumen.aprobados, ex: v.resumen.examen }));
check(v.rows.some((x) => x.examenPct != null) && v.rows.some((x) => x.examenPct == null), 'cada alumno nuevo con su nota; los de antes, sin nota');
check(/Examen de entrada/.test(v.nota), 'la nota lo explica');
check(v.resumen.sugeridas.length === 1 && v.resumen.sugeridas[0].dosAnosPct === 40 && v.resumen.sugeridas[0].quiebraEnLaHistoria === false && /×5$/.test(v.resumen.sugeridas[0].alumno), 'la vista enseña las sugeridas: ' + JSON.stringify(v.resumen.sugeridas[0]));
check(!JSON.stringify(v).includes('NaN'), 'sin NaN');

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
