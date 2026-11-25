// Pruebas de la v2.5: traders elegidos por su historial (lectura de la selección, habilidad previa, a quién se sigue).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
let AHORA = Date.UTC(2026, 10, 25, 13, 0, 0);
Date.now = () => AHORA;

const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') +
  '\nexport { apTraders, apHabilidades, apSeguidas, apDejarDeSeguir, apPosiciones, apStats, apSuma, AP_EXPERTOS, AP, CARTERAS_SEGUIDAS, TRADERS_MAX, TRADERS_ENCOGE, TRADERS_HORAS_PREVIA, VERSION };\n';
const tmp = path.join(os.tmpdir(), 'worker_v25_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);

const dir = (i) => '0x' + i.toString(16).padStart(40, '0');
let RESPUESTA = null, peticiones = 0;
globalThis.fetch = async (url) => {
  peticiones++;
  const u = new URL(url);
  if (u.host !== 'raw.githubusercontent.com' || !u.pathname.endsWith('/resultados/traders/seleccion.json')) throw new Error('inesperado ' + url);
  if (RESPUESTA == null) return new Response('no', { status: 404 });
  return new Response(typeof RESPUESTA === 'string' ? RESPUESTA : JSON.stringify(RESPUESTA), { status: 200 });
};
const seleccion = (n, extra = {}) => ({ version: 1, generado: '2026-11-25T04:40:00Z', usar_previa: true, carteras: Array.from({ length: n }, (_, i) => ({ direccion: dir(i + 1), t: 4 - i * 0.05, quincenas: 26, tipo: i % 5 ? 'cuenta' : 'vault' })), ...extra });
const nuevoE = () => ({ t: AHORA, carteras: {}, alertas: [] });

check(W.VERSION === '2.5.0', 'versión 2.5.0');

// 1) lectura de la selección
{
  const E = nuevoE();
  RESPUESTA = null;
  check((await W.apTraders(E)) === false && !E.traders && E.tradersIntento === AHORA, 'sin archivo: no cambia nada y apunta el intento');
  RESPUESTA = '{roto';
  check((await W.apTraders(E)) === false && !E.traders, 'JSON roto: se ignora');
  RESPUESTA = seleccion(4);
  check((await W.apTraders(E)) === false && !E.traders, 'menos de 5 carteras: se ignora');
  RESPUESTA = { ...seleccion(40), generado: '2027-01-01T00:00:00Z' };
  check((await W.apTraders(E)) === false && !E.traders, 'fecha del futuro: se ignora');
  const s = seleccion(40);
  s.carteras.splice(2, 0, { direccion: 'malo', t: 3 }, { direccion: dir(1), t: 9 }, { direccion: dir(999), t: -1 }, { direccion: dir(998), t: 'x' }, { direccion: dir(997).toUpperCase().replace('0X', '0x'), t: 99 });
  RESPUESTA = s;
  check((await W.apTraders(E)) === true && E.traders.lista.length === W.TRADERS_MAX, 'acepta como mucho ' + W.TRADERS_MAX + ': ' + (E.traders && E.traders.lista.length));
  const ds = E.traders.lista.map((x) => x.d);
  check(new Set(ds).size === ds.length && ds.every((d) => /^0x[0-9a-f]{40}$/.test(d)) && !ds.includes(dir(999)), 'solo direcciones bien formadas, sin repetidas ni puntuaciones no positivas');
  check(E.traders.lista.every((x) => x.t > 0 && x.t <= 8) && E.traders.lista.find((x) => x.d === dir(997)).t === 8, 'puntuación acotada a 8');
  check(E.traders.previa === true && E.traders.lista[0].tipo === 'vault' && E.traders.lista[1].tipo === 'cuenta', 'guarda si usa la previa y el tipo');
  check(E.alertas.length === 1 && /sigue a 30 \(30 nuevas\)/.test(E.alertas[0].texto), 'avisa de la nueva selección: ' + (E.alertas[0] && E.alertas[0].texto));
  check((await W.apTraders(E)) === false && E.alertas.length === 1, 'la misma selección otra vez: no cambia ni avisa');
  RESPUESTA = 'x'.repeat(40000);
  E.traders.gen = 'otra';
  check((await W.apTraders(E)) === false && E.traders.gen === 'otra', 'archivo demasiado grande: se ignora');
}

// 2) a quién se sigue
{
  const E = nuevoE();
  check(W.apSeguidas(E, AHORA) === W.CARTERAS_SEGUIDAS, 'sin selección: la lista fija');
  RESPUESTA = seleccion(30);
  await W.apTraders(E);
  const seg = W.apSeguidas(E, AHORA);
  check(seg.length === 30 && seg[0] === dir(1), 'con selección reciente: las 30 elegidas');
  check(W.apSeguidas(E, Date.parse('2026-11-25T04:40:00Z') + 15 * 86400e3) === W.CARTERAS_SEGUIDAS, 'si el laboratorio deja de publicar 15 días: vuelve a la lista fija');
  // dejar de seguir: guarda lo aprendido, quita posiciones; se olvida a los 60 días
  E.carteras[dir(1)] = { st: { n: 50 }, pos: { BTC: 1 }, px: { BTC: 1 }, av: 100, desde: AHORA, visto: AHORA };
  E.carteras[dir(500)] = { st: { n: 70 }, pos: { BTC: 1 }, px: { BTC: 1 }, av: 100, desde: AHORA, visto: AHORA };
  E.carteras[dir(501)] = { st: { n: 70 }, pos: { BTC: 1 }, px: { BTC: 1 }, av: 100, desde: 0, visto: AHORA - 61 * 86400e3 };
  W.apDejarDeSeguir(E, seg, AHORA);
  check(E.carteras[dir(1)].av === 100 && E.carteras[dir(1)].pos.BTC === 1, 'la que sigue elegida no se toca');
  check(E.carteras[dir(500)].av === null && !Object.keys(E.carteras[dir(500)].pos).length && E.carteras[dir(500)].st.n === 70, 'la que sale: sin posiciones ni valor, pero con lo aprendido');
  check(!E.carteras[dir(501)] && E.seguidas === 30, 'la que lleva 60 días fuera se olvida');
}

// 3) habilidad: sin previa, igual que antes; con previa, parte de ella y lo vivo va mandando
{
  const E = nuevoE();
  const st = W.apStats();
  for (let i = 0; i < 100; i++) W.apSuma(st, 0.001 + 0.002 * Math.sin(i));
  E.carteras[dir(1)] = { st, pos: {}, av: 1, desde: AHORA };
  E.carteras[dir(2)] = { st: W.apStats(), pos: {}, av: 1, desde: AHORA };
  const h0 = W.apHabilidades(E);
  const m = st.s1 / st.n, v = Math.max(st.s2 / st.n - m * m, 1e-12), tViejo = (m / Math.sqrt(v)) * Math.sqrt(st.n);
  check(Math.abs(h0[dir(1)].t - tViejo) < 1e-12 && h0[dir(2)].habilidad === 0, 'sin selección: misma habilidad que la v2.4');
  RESPUESTA = seleccion(30);
  await W.apTraders(E);
  const h1 = W.apHabilidades(E);
  const p2 = W.TRADERS_ENCOGE * E.traders.lista[1].t;
  check(Math.abs(h1[dir(2)].t - p2) < 1e-12 && h1[dir(2)].habilidad > 0.9 && h1[dir(2)].previa === p2, 'recién elegida, sin horas: parte de su previa encogida (t ' + h1[dir(2)].t.toFixed(2) + ')');
  // muchas horas en vivo perdiendo: la previa se diluye y la habilidad cae a cero
  const malo = W.apStats();
  for (let i = 0; i < 3000; i++) W.apSuma(malo, -0.001 + 0.002 * Math.sin(i));
  E.carteras[dir(2)].st = malo;
  const h2 = W.apHabilidades(E);
  check(h2[dir(2)].t < 0 && h2[dir(2)].habilidad === 0, 'con 3.000 horas perdiendo en vivo, la previa ya no la salva (t ' + h2[dir(2)].t.toFixed(2) + ')');
  // sin previa aprobada: se aprende en vivo
  E.traders.previa = false;
  const h3 = W.apHabilidades(E);
  check(h3[dir(3)] === undefined || h3[dir(3)].habilidad === 0, 'si el laboratorio no aprueba la previa, no se usa');
}

// 4) el experto que copia a las carteras con habilidad empieza ya, con la previa
{
  const E = nuevoE();
  E.monedas = {};
  for (const m of W.AP.MONEDAS) E.monedas[m] = { n: 800, px: 100, v2: 0 };
  const listas = ['BTC', 'ETH'];
  for (let i = 1; i <= 5; i++) E.carteras[dir(i)] = { st: W.apStats(), pos: { BTC: i % 2 ? 2000 : -500, ETH: 1000 }, av: 1e6, desde: AHORA };
  const exHab = W.AP_EXPERTOS.find((x) => x.id === 'copiar_mejores');
  const exRank = W.AP_EXPERTOS.find((x) => x.id === 'copiar_ranking');
  check(W.apPosiciones(E, exHab, listas, W.apHabilidades(E), AHORA) === null, 'sin previa y sin 24 horas: el experto espera');
  RESPUESTA = seleccion(30);
  await W.apTraders(E);
  const pos = W.apPosiciones(E, exHab, listas, W.apHabilidades(E), AHORA);
  check(pos && pos.BTC > 0 && pos.ETH > 0, 'con previa: copia desde la primera hora: ' + JSON.stringify(pos));
  check(W.apPosiciones(E, exRank, listas, W.apHabilidades(E), AHORA) === null, 'el de copiar al ranking (sin filtrar suerte) sigue esperando sus 24 horas');
  E.carteras[dir(1)].av = null;
  E.carteras[dir(3)].av = null;
  E.carteras[dir(5)].av = null;
  check(W.apPosiciones(E, exHab, listas, W.apHabilidades(E), AHORA) === null, 'las que dejan de seguirse no cuentan (quedan 2 de 5: espera)');
}

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
