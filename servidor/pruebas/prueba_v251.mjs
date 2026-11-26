// Pruebas de la v2.5.1: vistas del ranking semanal (lectura y validación del archivo del laboratorio).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') + '\nexport { aprendizaje, semanaLeer, VERSION };\n';
const tmp = path.join(os.tmpdir(), 'worker_v251_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);

const real = JSON.parse(fs.readFileSync(new URL('../../resultados/semana/ranking.json', import.meta.url), 'utf8'));
let RESP = null, pedidas = 0;
globalThis.fetch = async (url, op) => {
  pedidas++;
  if (!String(url).endsWith('/resultados/semana/ranking.json')) throw new Error('inesperado ' + url);
  if (!op || !op.cf || op.cf.cacheTtl !== 600) throw new Error('sin caché');
  if (RESP == null) return new Response('no', { status: 404 });
  return new Response(typeof RESP === 'string' ? RESP : JSON.stringify(RESP), { status: 200 });
};

check(/^2\.([5-9]|\d\d)\./.test(W.VERSION), 'versión 2.5 o posterior: ' + W.VERSION);
RESP = null;
let r = await W.aprendizaje({ vista: 'semana' }, {});
check(Array.isArray(r.rows) && r.rows.length === 0 && /no ha publicado/.test(r.nota), 'sin archivo: vacío y lo explica (sin pedir la base de datos)');
RESP = real;
r = await W.aprendizaje({ vista: 'semana' }, {});
check(r.rows.length === real.mercados.length && r.rows.length >= 20, 'el archivo real: ' + r.rows.length + ' mercados');
check(r.rows.every((m) => /^[A-Z0-9]{2,16}$/.test(m.simbolo) && ['al alza', 'a la baja'].includes(m.direccion)), 'símbolos y direcciones válidos');
check(r.rows.every((m) => m.fuerza === (m.puntuacion >= 1 ? 'fuerte' : m.puntuacion > 0 ? 'débil' : 'ninguna')), 'fuerza según la puntuación');
check(r.rows.filter((m) => m.enTop3).length <= 3, 'como mucho 3 elegidos');
const rs = await W.aprendizaje({ vista: 'semana_resumen' }, {});
check(rs.rows.length === 4 && rs.rows[0].que.startsWith('Las 3') && Number.isFinite(rs.rows[0].anualPct), 'resumen de la cartera: ' + JSON.stringify(rs.rows[0]));
const rf = await W.aprendizaje({ vista: 'semana_fuerza' }, {});
check(rf.rows.length >= 6 && rf.rows.every((f) => Number.isFinite(f.mediaSemanaSiguientePct)), 'tabla por fuerza: ' + rf.rows.length + ' tramos');
// validación de basura
RESP = { version: 1, generado: 'x'.repeat(100), mercados: [{ simbolo: '<script>', puntuacion: 2 }, { simbolo: 'BTC', nombre: 'y'.repeat(500), puntuacion: 'mucho', enTop3: 'sí', aciertoPct: Infinity }, null, 7], cartera: 5, global: { porFuerza: 'no' } };
r = await W.aprendizaje({ vista: 'semana' }, {});
check(r.rows.length === 1 && r.rows[0].simbolo === 'BTC' && r.rows[0].nombre.length === 60 && r.rows[0].puntuacion === null && r.rows[0].fuerza === null && r.rows[0].enTop3 === false && r.rows[0].aciertoPct === null, 'descarta símbolos raros, recorta textos y anula lo que no es número');
check(r.generado.length === 32, 'recorta la fecha');
check((await W.aprendizaje({ vista: 'semana_fuerza' }, {})).rows.length === 0, 'tabla por fuerza mal formada: vacía');
RESP = { version: 2, mercados: [] };
check(/formato/.test((await W.aprendizaje({ vista: 'semana' }, {})).nota), 'otra versión: se ignora');
RESP = '{roto';
check(/No se pudo/.test((await W.aprendizaje({ vista: 'semana' }, {})).nota), 'JSON roto: se ignora');
RESP = 'x'.repeat(70000);
check(/demasiado grande/.test((await W.aprendizaje({ vista: 'semana' }, {})).nota), 'demasiado grande: se ignora');
// las demás vistas siguen pidiendo la base de datos
let err = null;
try { await W.aprendizaje({ vista: 'resumen' }, {}); } catch (e) { err = e; }
check(err && /D1/.test(err.message), 'las vistas del sistema siguen necesitando la base de datos');
console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
