// Pruebas de la v2.5.2: avisos al móvil por ntfy (movimientos fuertes, tendencia fuerte del ranking semanal y resumen de la mañana).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') + '\nexport { aprendizaje, apMinuto, avisosHora, avisoMovimientos, madrid, fmtPx, AVISO, AP, VERSION };\n';
const tmp = path.join(os.tmpdir(), 'worker_v252_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);

const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  _run: () => db.prepare(sql).run(...args),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } };
const ENV = { TOKEN: 'secreto123', DB };
const MIN = 60e3, H = 3600e3;
let AHORA = Date.UTC(2026, 10, 25, 12, 1, 0);
Date.now = () => AHORA;

const PX = {}; for (const m of W.AP.MONEDAS) PX[m] = 100;
PX.BTC = 100000; PX.ETH = 3000;
const real = JSON.parse(fs.readFileSync(new URL('../../resultados/semana/ranking.json', import.meta.url), 'utf8'));
let RANK = real, ntfy = [], hl = 0, otras = 0, NTFY_OK = true;
globalThis.fetch = async (url, op = {}) => {
  url = String(url);
  if (url === 'https://ntfy.sh/') { ntfy.push(JSON.parse(op.body)); return new Response('{}', { status: NTFY_OK ? 200 : 429 }); }
  if (url.endsWith('/resultados/semana/ranking.json')) return new Response(JSON.stringify(RANK), { status: 200 });
  if (url.startsWith('https://api.hyperliquid.xyz/info')) {
    hl++;
    const { coin } = JSON.parse(op.body), p = PX[coin];
    return new Response(JSON.stringify({ levels: [[{ px: String(p * 0.9999), sz: '5' }], [{ px: String(p * 1.0001), sz: '5' }]] }), { status: 200 });
  }
  otras++; throw new Error('inesperado ' + url);
};

check(/^2\.5\.2$/.test(W.VERSION), 'versión ' + W.VERSION);
// hora de Madrid con cambio de horario
check(W.madrid(Date.UTC(2026, 10, 26, 7, 47)).hora === 8 && W.madrid(Date.UTC(2026, 6, 1, 6, 47)).hora === 8, 'Madrid: 8:47 en invierno (7:47 UTC) y en verano (6:47 UTC)');
check(W.madrid(Date.UTC(2026, 10, 28, 9)).laborable === false && W.madrid(Date.UTC(2026, 10, 27, 9)).laborable === true, 'sábado no es laborable; viernes sí');
check(W.fmtPx(94800) === '94.800' && W.fmtPx(3.456) === '3,46' && W.fmtPx(0.0123) === '0,0123', 'formato de precios: ' + [W.fmtPx(94800), W.fmtPx(3.456), W.fmtPx(0.0123)].join(' · '));

// base de datos con el sistema al día
db.exec('CREATE TABLE IF NOT EXISTS ap_estado (id TEXT PRIMARY KEY, json TEXT NOT NULL, t INTEGER)');
db.exec('CREATE TABLE IF NOT EXISTS ap_curva (t INTEGER PRIMARY KEY, s REAL, b REAL, n INTEGER)');
const hora = (t) => Math.floor(t / H) * H;
const alDia = () => db.prepare("INSERT INTO ap_estado (id, json, t) VALUES ('principal', '{}', ?) ON CONFLICT(id) DO UPDATE SET t = excluded.t").run(hora(AHORA));
const pasos = async (n) => { for (let i = 0; i < n; i++) { alDia(); await W.apMinuto(ENV); AHORA += MIN; } };

// 1) precios quietos 40 minutos: ni un aviso
await pasos(40);
check(ntfy.length === 0, 'precios quietos: ningún aviso');
const F = () => JSON.parse(db.prepare("SELECT json FROM ap_estado WHERE id = 'flujo'").get().json);
const nMuestras = F().px.BTC.length;
check(nMuestras >= 8 && nMuestras <= 14, 'una muestra cada ~5 minutos: ' + nMuestras + ' en 40 min');
check(otras === 0, 'sin peticiones inesperadas');

// 2) BTC cae un 5,2 %: un aviso con sonido (de día)
PX.BTC = 94800;
alDia(); let r = await W.apMinuto(ENV); AHORA += MIN;
check(r.avisos === 1 && ntfy.length === 1, 'BTC −5,2 %: un aviso');
const a1 = ntfy[0];
check(/^radar-[a-km-np-z2-9]{15}$/.test(a1.topic), 'canal al azar: radar- y 15 letras/cifras');
check(/^BTC cae un 5,2 % en \d+ min$/.test(a1.title) && a1.priority === 4 && a1.tags[0] === 'chart_with_downwards_trend', 'título y prioridad: ' + a1.title);
check(/de 100\.000 a 94\.800 \$/.test(a1.message) && !/undefined|NaN|null/.test(a1.message + a1.title), 'texto: ' + a1.message.split('\n')[0]);
// 3) sigue igual: no se repite
await pasos(5);
check(ntfy.length === 1, 'el mismo movimiento no se repite');
// 4) cae otro 5 %: aviso nuevo
PX.BTC = 89900;
await pasos(1);
check(ntfy.length === 2 && /BTC cae/.test(ntfy[1].title), 'otro 5 % más abajo: aviso nuevo (' + ntfy[1].title + ')');
// 5) SOL −6 %: no (umbral del 10 % para el resto); −11 %: sí
PX.SOL = 94; await pasos(2);
check(ntfy.length === 2, 'SOL −6 %: sin aviso (umbral 10 %)');
PX.SOL = 89; await pasos(1);
check(ntfy.length === 3 && /^SOL cae un 11/.test(ntfy[2].title), 'SOL −11 %: aviso (' + ntfy[2].title + ')');
// 6) dato roto (+60 %): no se avisa
PX.XRP = 160; await pasos(1);
check(ntfy.length === 3, 'salto del 60 % en una hora: dato roto, sin aviso');
PX.XRP = 100; await pasos(1);
check(ntfy.length === 3, 'vuelve a su precio tras el dato roto: sin aviso');
// 7) varias a la vez: un solo mensaje
PX.ETH = 3200; PX.LINK = 112; PX.AVAX = 113;
await pasos(1);
check(ntfy.length === 4 && /^Movimiento fuerte: /.test(ntfy[3].title) && ntfy[3].message.split('\n').length === 4, 'tres monedas a la vez: un solo aviso (' + ntfy[3].title + ')');
// 8) de noche: sin sonido
await pasos(70); // pasa la hora: los precios nuevos son la referencia
AHORA = Date.UTC(2026, 10, 25, 23, 30); await pasos(10);
const n8 = ntfy.length;
PX.ETH = 3000; await pasos(1);
check(ntfy.length === n8 + 1 && ntfy[n8].priority === 2, 'de noche: aviso sin sonido (prioridad 2)');
check(F().px.BTC.length <= 14, 'las muestras de más de 65 minutos se borran');
// 9) ntfy falla: queda anotado y no rompe el minuto
NTFY_OK = false; PX.ETH = 3300; r = await (async () => { alDia(); return W.apMinuto(ENV); })(); AHORA += MIN; NTFY_OK = true;
const vista = await W.aprendizaje({ vista: 'avisos' }, ENV);
check(r.ok && vista.rows[0].ok === false && vista.rows[0].estado === 429, 'ntfy rechaza: se anota el estado y el minuto sigue');
check(vista.canal === a1.topic && vista.servidor === 'ntfy.sh', 'la vista avisos da el canal guardado');

// 10) ranking semanal: la primera lectura fija el punto de partida
ntfy = [];
AHORA = Date.UTC(2026, 10, 26, 13, 47);
const conFuerza = (simbolos) => ({ ...real, generado: new Date(AHORA).toISOString(), mercados: real.mercados.map((m) => ({ ...m, puntuacion: simbolos.includes(m.simbolo) ? 1.3 : Math.min(m.puntuacion, 0.5) })) });
const s1 = real.mercados[3].simbolo, s2 = real.mercados[5].simbolo;
RANK = conFuerza([]);
await W.avisosHora(ENV);
check(ntfy.length === 0, 'primera lectura del ranking: sin aviso');
// entra un mercado de día: aviso al momento
AHORA += H; RANK = conFuerza([s1]);
await W.avisosHora(ENV);
check(ntfy.length === 1 && ntfy[0].title === 'Tendencia fuerte: entra ' + s1 && /^Entra .+ puntuación 1,30/.test(ntfy[0].message), 'entra ' + s1 + ' de día: ' + ntfy[0].message.split('\n')[0]);
// mismo ranking otra vez: nada
AHORA += H; await W.avisosHora(ENV);
check(ntfy.length === 1, 'el mismo ranking no avisa dos veces');
// de noche: entra otro y sale el primero → espera al resumen
AHORA = Date.UTC(2026, 10, 26, 23, 47); RANK = conFuerza([s2]);
await W.avisosHora(ENV);
check(ntfy.length === 1, 'de noche el cambio del ranking espera');
// resumen del viernes a las 8:47 de Madrid con lo de la noche
AHORA = Date.UTC(2026, 10, 27, 6, 47); await W.avisosHora(ENV);
check(ntfy.length === 1, 'a las 7:47 de Madrid aún no hay resumen');
AHORA = Date.UTC(2026, 10, 27, 7, 47); await W.avisosHora(ENV);
const res = ntfy[1];
check(res && res.title === 'Radar: buenos días' && res.message.includes('En tendencia fuerte:') && res.message.includes('Novedades del ranking:') && res.message.includes('Entra ') && res.message.includes('Sale ') && !/undefined|NaN|null/.test(res.message), 'resumen con lo de la noche:\n      ' + (res ? res.message.replace(/\n/g, '\n      ') : ''));
AHORA += 20 * MIN; await W.avisosHora(ENV);
check(ntfy.length === 2, 'un solo resumen por día');
// sábado sin novedades: sin resumen
AHORA = Date.UTC(2026, 10, 28, 7, 47); await W.avisosHora(ENV);
check(ntfy.length === 2, 'sábado sin novedades: sin resumen');
// lunes sin mercados fuertes
AHORA = Date.UTC(2026, 10, 30, 7, 47); RANK = conFuerza([]); await W.avisosHora(ENV);
check(ntfy.length === 3 && /Ningún mercado en tendencia fuerte/.test(ntfy[2].message) && ntfy[2].message.includes('Sale ') && ntfy[2].message.includes('(' + s2 + ')'), 'lunes a las 8:47: el cambio va dentro del resumen, un solo mensaje');
// ranking ilegible a la hora del resumen: avisa de que no lo pudo leer
RANK = { version: 9 }; AHORA = Date.UTC(2026, 11, 1, 7, 47); await W.avisosHora(ENV);
check(ntfy.length === 4 && /No he podido leer el ranking/.test(ntfy[3].message), 'ranking ilegible: el resumen lo dice');

// 11) aviso de prueba: uno cada 10 minutos como mucho
const p1 = await W.aprendizaje({ vista: 'avisos_prueba' }, ENV);
const p2 = await W.aprendizaje({ vista: 'avisos_prueba' }, ENV);
check(p1.prueba === 'Prueba enviada.' && /hace menos de 10/.test(p2.prueba) && ntfy.length === 5 && ntfy[4].title === 'Radar: aviso de prueba', 'prueba: la primera sale, la segunda espera');
AHORA += 11 * MIN;
check((await W.aprendizaje({ vista: 'avisos_prueba' }, ENV)).prueba === 'Prueba enviada.', 'a los 11 minutos se puede repetir');
const v = await W.aprendizaje({ vista: 'avisos' }, ENV);
check(v.rows.length <= W.AVISO.MAX_GUARDADOS && v.rows.every((x) => typeof x.titulo === 'string' && typeof x.t === 'string'), 'historial de avisos acotado: ' + v.rows.length);
check(new Set(ntfy.map((x) => x.topic)).size === 1, 'siempre el mismo canal');
// el canal no está en el código
check(!fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8').includes(a1.topic), 'el canal no aparece en el código');

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
