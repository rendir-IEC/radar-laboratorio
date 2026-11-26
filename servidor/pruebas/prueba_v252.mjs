// Pruebas de la v2.5.2: avisos al móvil por ntfy, solo para actuar o seguir algo importante
// (señal del ranking semanal, plan de Bitcoin de los lunes y movimientos fuertes de BTC y ETH). Sin resúmenes.
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
const MIN = 60e3, H = 3600e3, DIA = 86400e3;
let AHORA = Date.UTC(2026, 10, 25, 12, 1, 0);
Date.now = () => AHORA;

const PX = {}; for (const m of W.AP.MONEDAS) PX[m] = 100;
PX.BTC = 100000; PX.ETH = 3000;
const real = JSON.parse(fs.readFileSync(new URL('../../resultados/semana/ranking.json', import.meta.url), 'utf8'));
// Bitcoin diario sintético: 100.000 $ cada día, el último cierre completo a CIERRE_BTC y el día en curso a 1 $ (no debe contar)
let CIERRE_BTC = 83000, bitstamp = 0;
let RANK = real, ntfy = [], otras = 0, NTFY_OK = true;
globalThis.fetch = async (url, op = {}) => {
  url = String(url);
  if (url === 'https://ntfy.sh/') { ntfy.push(JSON.parse(op.body)); return new Response('{}', { status: NTFY_OK ? 200 : 429 }); }
  if (url.endsWith('/resultados/semana/ranking.json')) return new Response(JSON.stringify(RANK), { status: 200 });
  if (url.startsWith('https://www.bitstamp.net/api/v2/ohlc/btcusd/')) {
    bitstamp++;
    const hoy = Math.floor(AHORA / DIA) * DIA, ohlc = [];
    for (let k = 300; k >= 0; k--) { const c = k === 0 ? 1 : k === 1 ? CIERRE_BTC : 100000; ohlc.push({ timestamp: String((hoy - k * DIA) / 1000), open: String(c), high: String(c), low: String(c), close: String(c) }); }
    return new Response(JSON.stringify({ data: { ohlc } }), { status: 200 });
  }
  if (url.startsWith('https://api.hyperliquid.xyz/info')) {
    const { coin } = JSON.parse(op.body), p = PX[coin];
    return new Response(JSON.stringify({ levels: [[{ px: String(p * 0.9999), sz: '5' }], [{ px: String(p * 1.0001), sz: '5' }]] }), { status: 200 });
  }
  otras++; throw new Error('inesperado ' + url);
};

check(/^2\.5\.2$/.test(W.VERSION), 'versión ' + W.VERSION);
check(W.madrid(Date.UTC(2026, 10, 26, 7, 47)).hora === 8 && W.madrid(Date.UTC(2026, 6, 1, 6, 47)).hora === 8, 'Madrid: 8:47 en invierno (7:47 UTC) y en verano (6:47 UTC)');
check(W.madrid(Date.UTC(2026, 10, 30, 8, 47)).dia === 'Mon' && W.madrid(Date.UTC(2026, 10, 28, 9)).laborable === false, 'lunes 30-11 y sábado 28-11 bien identificados');
check(W.fmtPx(94800) === '94.800' && W.fmtPx(3.456) === '3,46' && W.fmtPx(0.0123) === '0,0123', 'formato de precios: ' + [W.fmtPx(94800), W.fmtPx(3.456), W.fmtPx(0.0123)].join(' · '));

db.exec('CREATE TABLE IF NOT EXISTS ap_estado (id TEXT PRIMARY KEY, json TEXT NOT NULL, t INTEGER)');
db.exec('CREATE TABLE IF NOT EXISTS ap_curva (t INTEGER PRIMARY KEY, s REAL, b REAL, n INTEGER)');
const hora = (t) => Math.floor(t / H) * H;
const alDia = () => db.prepare("INSERT INTO ap_estado (id, json, t) VALUES ('principal', '{}', ?) ON CONFLICT(id) DO UPDATE SET t = excluded.t").run(hora(AHORA));
const pasos = async (n) => { for (let i = 0; i < n; i++) { alDia(); await W.apMinuto(ENV); AHORA += MIN; } };
const F = () => JSON.parse(db.prepare("SELECT json FROM ap_estado WHERE id = 'flujo'").get().json);

// 1) movimientos de precio: solo BTC y ETH
await pasos(40);
check(ntfy.length === 0, 'precios quietos: ningún aviso');
const nMuestras = F().px.BTC.length;
check(nMuestras >= 8 && nMuestras <= 14 && Object.keys(F().px).sort().join() === 'BTC,ETH', 'solo se guardan muestras de BTC y ETH, cada ~5 minutos: ' + nMuestras + ' en 40 min');
PX.BTC = 94800;
alDia(); let r = await W.apMinuto(ENV); AHORA += MIN;
check(r.avisos === 1 && ntfy.length === 1, 'BTC −5,2 %: un aviso');
const a1 = ntfy[0];
check(/^radar-[a-km-np-z2-9]{15}$/.test(a1.topic), 'canal al azar: radar- y 15 letras/cifras');
check(/^BTC cae un 5,2 % en \d+ min$/.test(a1.title) && a1.priority === 4 && a1.tags[0] === 'chart_with_downwards_trend', 'título y prioridad: ' + a1.title);
check(/de 100\.000 a 94\.800 \$/.test(a1.message) && !/undefined|NaN|null/.test(a1.message + a1.title), 'texto: ' + a1.message.split('\n')[0]);
await pasos(5);
check(ntfy.length === 1, 'el mismo movimiento no se repite');
PX.BTC = 89900; await pasos(1);
check(ntfy.length === 2 && /BTC cae/.test(ntfy[1].title), 'otro 5 % más abajo: aviso nuevo (' + ntfy[1].title + ')');
PX.SOL = 80; PX.XRP = 130; await pasos(2);
check(ntfy.length === 2, 'SOL −20 % y XRP +30 %: sin aviso (solo se vigilan BTC y ETH)');
PX.ETH = 4800; await pasos(1);
check(ntfy.length === 2, 'ETH +60 % en una hora: dato roto, sin aviso');
PX.ETH = 3000; await pasos(1);
check(ntfy.length === 2, 'vuelve a su precio tras el dato roto: sin aviso');
PX.ETH = 3200; PX.BTC = 95000; await pasos(1);
check(ntfy.length === 3 && /^Movimiento fuerte: /.test(ntfy[2].title) && ntfy[2].message.split('\n').length === 3, 'BTC y ETH a la vez: un solo aviso (' + ntfy[2].title + ')');
await pasos(70);
AHORA = Date.UTC(2026, 10, 25, 23, 30); await pasos(10);
const n8 = ntfy.length;
PX.ETH = 3000; await pasos(1);
check(ntfy.length === n8 + 1 && ntfy[n8].priority === 2, 'de noche: aviso de precio sin sonido (prioridad 2)');
check(F().px.BTC.length <= 14, 'las muestras de más de 65 minutos se borran');
NTFY_OK = false; PX.ETH = 3300; alDia(); r = await W.apMinuto(ENV); AHORA += MIN; NTFY_OK = true;
let vista = await W.aprendizaje({ vista: 'avisos' }, ENV);
check(r.ok && vista.rows[0].ok === false && vista.rows[0].estado === 429, 'ntfy rechaza: se anota el estado y el minuto sigue');
check(vista.canal === a1.topic && vista.servidor === 'ntfy.sh', 'la vista avisos da el canal guardado');

// 2) ranking semanal: señal de tendencia fuerte, sin resúmenes
ntfy = [];
AHORA = Date.UTC(2026, 10, 26, 13, 47);
const conFuerza = (simbolos) => ({ ...real, generado: new Date(AHORA).toISOString(), mercados: real.mercados.map((m) => ({ ...m, puntuacion: simbolos.includes(m.simbolo) ? 1.3 : Math.min(m.puntuacion, 0.5) })) });
const s1 = real.mercados[3].simbolo, s2 = real.mercados[5].simbolo;
RANK = conFuerza([]);
await W.avisosHora(ENV);
check(ntfy.length === 0, 'primera lectura del ranking: sin aviso');
AHORA += H; RANK = conFuerza([s1]); await W.avisosHora(ENV);
check(ntfy.length === 1 && ntfy[0].title === 'Tendencia fuerte: entra ' + s1 && /^Entra .+ puntuación 1,30/.test(ntfy[0].message), 'entra ' + s1 + ' de día: ' + ntfy[0].message.split('\n')[0]);
AHORA += H; await W.avisosHora(ENV);
check(ntfy.length === 1, 'el mismo ranking no avisa dos veces');
AHORA = Date.UTC(2026, 10, 26, 23, 47); RANK = conFuerza([s2]); await W.avisosHora(ENV);
check(ntfy.length === 1, 'de noche el cambio del ranking espera');
AHORA = Date.UTC(2026, 10, 27, 6, 47); await W.avisosHora(ENV);
check(ntfy.length === 1, 'a las 7:47 de Madrid sigue esperando');
AHORA = Date.UTC(2026, 10, 27, 7, 47); await W.avisosHora(ENV);
const m2 = ntfy[1];
check(m2 && m2.title === 'Tendencia fuerte: entra ' + s2 + ' · sale ' + s1 && m2.message.includes('Sale ') && !/undefined|NaN|null|buenos días/i.test(m2.title + m2.message), 'a las 8:47 sale lo de la noche como señal: ' + (m2 && m2.title));
AHORA += H; await W.avisosHora(ENV);
AHORA = Date.UTC(2026, 10, 28, 7, 47); await W.avisosHora(ENV);
AHORA = Date.UTC(2026, 11, 1, 7, 47); await W.avisosHora(ENV);
check(ntfy.length === 2, 'sin novedades no hay ningún mensaje (ni resumen diario)');

// 3) plan de Bitcoin de los lunes a las 9:47 de Madrid
ntfy = [];
AHORA = Date.UTC(2026, 10, 23, 8, 47); await W.avisosHora(ENV);
check(ntfy.length === 0 && bitstamp === 0, 'lunes 23-11: aún no (empieza el 30-11)');
AHORA = Date.UTC(2026, 10, 30, 7, 47); await W.avisosHora(ENV);
check(ntfy.length === 0, 'lunes 30-11 a las 8:47: aún no es la hora del plan');
AHORA = Date.UTC(2026, 10, 30, 8, 47); CIERRE_BTC = 83000; await W.avisosHora(ENV);
const pl = ntfy[0];
check(pl && pl.title === 'Plan de Bitcoin: esta semana 120 €', 'lunes 30-11 a las 9:47: ' + (pl && pl.title));
check(pl && /cerró el 29\/11 en 83\.000 \$, un 17 % por debajo de su media de 200 días \(múltiplo 0,83 → ×1,5 sobre la base de 80 €\)/.test(pl.message), 'texto del plan: ' + (pl && pl.message.split('\n')[0]));
AHORA += 20 * MIN; await W.avisosHora(ENV);
check(ntfy.length === 1, 'un solo aviso del plan por lunes');
AHORA = Date.UTC(2026, 11, 1, 8, 47); await W.avisosHora(ENV);
check(ntfy.length === 1, 'martes: sin aviso del plan');
AHORA = Date.UTC(2026, 11, 7, 8, 47); CIERRE_BTC = 300000; await W.avisosHora(ENV);
vista = await W.aprendizaje({ vista: 'avisos' }, ENV);
check(ntfy.length === 1 && vista.vigilando.ultimoPlan && vista.vigilando.ultimoPlan.compraEur === 0, 'lunes con Bitcoin muy caro: la regla no compra y no se avisa');
AHORA = Date.UTC(2026, 11, 14, 8, 47); CIERRE_BTC = 70000; await W.avisosHora(ENV);
check(ntfy.length === 2 && ntfy[1].title === 'Plan de Bitcoin: esta semana 160 €', 'Bitcoin un 30 % bajo su media: ×2 → ' + (ntfy[1] && ntfy[1].title));

// 4) aviso de prueba
ntfy = [];
const p1 = await W.aprendizaje({ vista: 'avisos_prueba' }, ENV);
const p2 = await W.aprendizaje({ vista: 'avisos_prueba' }, ENV);
check(p1.prueba === 'Prueba enviada.' && /hace menos de 10/.test(p2.prueba) && ntfy.length === 1 && ntfy[0].title === 'Radar: aviso de prueba', 'prueba: la primera sale, la segunda espera');
AHORA += 11 * MIN;
check((await W.aprendizaje({ vista: 'avisos_prueba' }, ENV)).prueba === 'Prueba enviada.', 'a los 11 minutos se puede repetir');
vista = await W.aprendizaje({ vista: 'avisos' }, ENV);
check(vista.rows.length <= W.AVISO.MAX_GUARDADOS && vista.rows.every((x) => typeof x.titulo === 'string' && typeof x.t === 'string'), 'historial de avisos acotado: ' + vista.rows.length);
check(/solo para actuar/.test(vista.nota) && !/resumen de lunes/i.test(vista.nota), 'la nota de la vista explica qué avisa');
check(!fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8').includes(a1.topic), 'el canal no aparece en el código');
check(otras === 0, 'sin peticiones inesperadas');

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
