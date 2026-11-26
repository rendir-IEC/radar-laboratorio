import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
// D1 mínimo sobre SQLite
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  _run: () => db.prepare(sql).run(...args),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } };
const ENV = { TOKEN: 'secreto123', DB };
const H = 3600e3, MIN = 60e3;
let AHORA = Date.UTC(2026, 10, 24, 21, 30, 0);
const realNow = Date.now; Date.now = () => AHORA;
const RealDate = Date;
let llamadas = 0, porTipo = {};
// mercado sintético determinista: precio = f(moneda, hora)
const precio = (m, t) => { let s = 0; for (const ch of m) s += ch.charCodeAt(0); const h = Math.floor(t / H); return 100 * (1 + (s % 7)) * Math.exp(0.02 * Math.sin(h / 50 + s) + 0.01 * Math.sin(h / 7 + s * 3)); };
const resp = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fichaLab = (id, spec, aprobada) => ({ id, nombre: 'Prueba ' + id, spec, aprobada, sharpe_anual: 1.2, sharpe_deflactado: 0.97 });
const LAB_JSON = {
  generado: '2026-11-25T03:00:00Z', para_el_servidor_estado: 'aprobadas',
  pruebas: { estrategias_probadas: 2232, aprobadas: 2, probabilidad_sobreajuste: 0.2, sharpe_anual_que_daria_la_suerte: 1.5 },
  procedimiento_fuera_de_muestra: { top5: { rent_anual_pct: 10, sharpe_anual: 1, caida_max_pct: 8, dias: 900 }, comprar_y_mantener_btc: { rent_anual_pct: 30, sharpe_anual: 0.7, caida_max_pct: 60, dias: 900 } },
  periodo: { desde: '2021-02-01', hasta: '2026-11-24' },
  estrategias: [
    fichaLab('lab_cruce_24_168_c0.5_sec_amb_nf_h1', { senal: 'cruce', a: 24, b: 168, forma: 'continua', k: 0.5, modo: 'seccion', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
    fichaLab('lab_impulso_168_s_ser_lar_ba_h24', { senal: 'impulso', a: 168, forma: 'signo', modo: 'serie', lado: 'largos', filtro: 'btc_alcista', cada: 24 }, true),
    fichaLab('lab_funding_contra_168_s_ser_amb_nf_h1', { senal: 'funding_contra', a: 168, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, false),
    fichaLab('lab_malo_1', { senal: 'eval', a: 24, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
    fichaLab('tend_24_168', { senal: 'cruce', a: 24, b: 168, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
  ],
  para_el_servidor: ['lab_cruce_24_168_c0.5_sec_amb_nf_h1', 'lab_impulso_168_s_ser_lar_ba_h24', 'lab_funding_contra_168_s_ser_amb_nf_h1', 'lab_malo_1', 'tend_24_168'],
};
let HUECO_ETH = () => false;
let metaOriginal = null;
globalThis.fetch = async (url, init = {}) => {
  llamadas++;
  const u = new URL(url);
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/senal.json')) { porTipo.ml = (porTipo.ml || 0) + 1; return new Response('no', { status: 404 }); }
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/traders/seleccion.json')) { porTipo.traders = (porTipo.traders || 0) + 1; return new Response('no', { status: 404 }); }
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/semana/ranking.json')) { porTipo.semana = (porTipo.semana || 0) + 1; return new Response('no', { status: 404 }); }
  if (u.host === 'ntfy.sh') { porTipo.ntfy = (porTipo.ntfy || 0) + 1; return new Response('{}', { status: 200 }); }
  if (u.host === 'raw.githubusercontent.com') { porTipo.lab = (porTipo.lab || 0) + 1; return resp(LAB_JSON); }
  if (u.host !== 'api.hyperliquid.xyz') throw new Error('Host no simulado ' + u.host);
  if (JSON.parse(init.body).type === 'metaAndAssetCtxs' && !JSON.parse(init.body).dex && HUECO_ETH(AHORA)) { const r = await metaOriginal(url, init); const j = await r.json(); const i = j[0].universe.findIndex((a) => a.name === 'ETH'); j[1][i].markPx = ''; return resp(j); }
  const b = JSON.parse(init.body);
  porTipo[b.type] = (porTipo[b.type] || 0) + 1;
  if (b.type === 'candleSnapshot') { const out = []; for (let t = Math.ceil(b.req.startTime / H) * H; t <= b.req.endTime; t += H) out.push({ t, c: String(precio(b.req.coin, t + H)) }); return resp(out); }
  if (b.type === 'fundingHistory') { const out = []; for (let t = Math.ceil(b.startTime / H) * H; t <= b.endTime && out.length < 500; t += H) out.push({ coin: b.coin, fundingRate: String(0.0000125 + 0.00001 * Math.sin(t / H / 30)), time: t }); return resp(out); }
  if (b.type === 'metaAndAssetCtxs' && b.dex === 'xyz') { porTipo.xyz = (porTipo.xyz || 0) + 1; const xs = ['GOLD', 'SILVER', 'CL', 'NATGAS', 'COPPER', 'SP500', 'XYZ100', 'EUR', 'JPY', 'TSLA']; return resp([{ universe: xs.map((n) => ({ name: 'xyz:' + n, maxLeverage: 10 })) }, xs.map((n) => ({ markPx: String(precio('xyz:' + n, AHORA)), funding: '0.00001', openInterest: '1000', dayNtlVlm: '1e6' }))]); }
  if (b.type === 'metaAndAssetCtxs') { const nombres = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE', 'TRUMP']; return resp([{ universe: nombres.map((n) => ({ name: n, maxLeverage: 10 })) }, nombres.map((n) => ({ markPx: String(precio(n, AHORA)), funding: '0.0000125', openInterest: '1000', dayNtlVlm: '1e6' }))]); }
  if (b.type === 'clearinghouseState') { const k = parseInt(b.user.slice(2, 4), 16); return resp({ marginSummary: { accountValue: String(1e6) }, assetPositions: [{ position: { coin: 'BTC', szi: String((k % 2 ? 1 : -1) * 5) } }, { position: { coin: 'TRUMP', szi: '100' } }] }); }
  if (b.type === 'l2Book') { const m = Math.floor(AHORA / MIN); const sesgo = Math.sin(m / 13 + b.coin.length); const lado = (base, s) => Array.from({ length: 20 }, (_, i) => ({ px: String(base + s * i * 0.5), sz: String(1 + Math.abs(Math.sin(m * (i + 1))) + (s < 0 ? Math.max(0, sesgo) : Math.max(0, -sesgo))), n: 3 })); const p = precio(b.coin, AHORA); return resp({ coin: b.coin, time: AHORA, levels: [lado(p - 0.5 + 0.1 * Math.sin(m), -1), lado(p + 0.5 + 0.1 * Math.cos(m), 1)] }); }
  throw new Error('tipo no simulado ' + b.type);
};
metaOriginal = async (url, init) => { const b = JSON.parse(init.body); const nombres = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE', 'TRUMP']; return resp([{ universe: nombres.map((n) => ({ name: n, maxLeverage: 10 })) }, nombres.map((n) => ({ markPx: String(precio(n, AHORA)), funding: '0.0000125', openInterest: '1000', dayNtlVlm: '1e6' }))]); };
const { default: worker } = await import('../worker.js');
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + m); if (!c) process.exitCode = 1; };
const ejecutar = async () => { const esperas = []; llamadas = 0; const t0 = process.hrtime.bigint(); await worker.scheduled({}, ENV, { waitUntil: (p) => esperas.push(p) }); await Promise.all(esperas); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, llamadas }; };
const herramienta = async (name, args = {}) => { const r = await worker.fetch(new Request('https://x.workers.dev/mcp/secreto123', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), ENV); const j = await r.json(); return JSON.parse(j.result.content[0].text); };
// 1) repaso de la historia
let maxLl = 0, maxMs = 0, ciclos = 0, msTot = 0;
for (; ciclos < 400; ciclos++) {
  const r = await ejecutar(); maxLl = Math.max(maxLl, r.llamadas); msTot += r.ms; if (ciclos > 5) maxMs = Math.max(maxMs, r.ms);
  const res = await herramienta('aprendizaje', { vista: 'resumen' });
  if (res.rows[0].modo === 'en vivo') break;
  AHORA += MIN;
}
const res0 = (await herramienta('aprendizaje', { vista: 'resumen' })).rows[0];
check(res0.modo === 'en vivo', 'el repaso termina en ' + (ciclos + 1) + ' ciclos de un minuto (' + res0.horasAprendidas + ' horas aprendidas)');
check(maxLl <= 50, 'peticiones externas por ciclo durante el repaso: máximo ' + maxLl + ' (límite 50)');
console.log('     tiempo por ciclo de repaso (incluye SQLite y simulación): media ' + (msTot / (ciclos + 1)).toFixed(1) + ' ms, máximo ' + maxMs.toFixed(1) + ' ms');
// 2) en vivo, minuto a minuto durante 8 horas
let maxVivo = 0, horasVivas = 0, cpuMin = [];
const t0 = AHORA;
const estado = () => JSON.parse(db.prepare("SELECT json FROM ap_estado WHERE id = 'principal'").get().json);
const nEthAntes = estado().monedas.ETH.n, nBtcAntes = estado().monedas.BTC.n;
const huecoDesde = Math.ceil((t0 + 2 * H) / H) * H;
HUECO_ETH = (ahora) => ahora >= huecoDesde && ahora < huecoDesde + 3 * H;
while (AHORA < t0 + 8 * H) {
  AHORA += MIN;
  const r = await ejecutar(); maxVivo = Math.max(maxVivo, r.llamadas); cpuMin.push(r.ms);
}
check(maxVivo <= 50, 'peticiones externas por minuto en vivo: máximo ' + maxVivo + ' (la hora en vivo usa 32; el flujo, 20)');
{ const E = estado(); const xyz = ['xyz:GOLD', 'xyz:SILVER', 'xyz:CL', 'xyz:NATGAS', 'xyz:COPPER', 'xyz:SP500', 'xyz:XYZ100', 'xyz:EUR', 'xyz:JPY'];
  const listos = xyz.filter((m) => E.monedas[m] && E.monedas[m].n >= 720);
  check(listos.length === 9 && !(E.fueraDex || []).some((m) => m.startsWith('xyz:')), 'oro, plata, petróleo, gas, cobre, S&P 500, Nasdaq, euro y yen se calientan y aprenden: ' + listos.length + ' de 9');
  const conXyz = Object.values(E.expertos).filter((X) => Object.keys(X.pos || {}).some((m) => m.startsWith('xyz:'))).length;
  check(conXyz >= 5 && Object.keys(E.posSistema).some((m) => m.startsWith('xyz:')), 'los expertos operan también esos mercados: ' + conXyz + ' expertos con alguno');
  check(!Object.keys(E.expertos.carry_alt.pos || {}).some((m) => m.startsWith('xyz:')) && !Object.keys(E.monedas).includes('xyz:TSLA'), 'el cobro del funding sigue solo en cripto y no entra lo que no está en la lista (TSLA)');
  check((porTipo.xyz || 0) >= 7 && (porTipo.xyz || 0) <= 10, 'precios de trade.xyz: 1 petición por hora en vivo (' + porTipo.xyz + ' en 8 h)'); }
{ const fp = db.prepare("SELECT json FROM ap_estado WHERE id = 'practicas'").get(); const P0 = fp ? JSON.parse(fp.json) : null;
  check(P0 && P0.alumnos.some((A) => Object.keys(A.pos).some((m) => m.startsWith('xyz:'))), 'los alumnos de la zona de prácticas también operan oro, petróleo, índices o divisas'); }
{ const fp = db.prepare("SELECT json FROM ap_estado WHERE id = 'practicas'").get(); const P = fp ? JSON.parse(fp.json) : null;
  check(P && P.alumnos.length === 36 && P.alumnos.filter((A) => A.grupo === 'arriesgado').length === 12 && P.alumnos.every((A) => A.st.n >= 6), 'zona de prácticas en vivo: ' + (P ? P.alumnos.length + ' alumnos, ' + Math.min(...P.alumnos.map((A) => A.st.n)) + '–' + Math.max(...P.alumnos.map((A) => A.st.n)) + ' h, ' + Math.round(fp.json.length / 1024) + ' KB' : 'no existe')); }
const exp = (await herramienta('aprendizaje', { vista: 'expertos' })).rows;
const flujo = exp.filter((x) => x.familia === 'flujo de órdenes');
check(flujo.length === 4 && flujo.every((x) => x.horas > 0), 'los 4 expertos de flujo de órdenes aprenden en vivo: ' + flujo.map((x) => x.id + ' ' + x.horas + ' h').join(', '));
check(exp.length === 26, 'hay 26 expertos: 23 fijos (con el de aprendizaje automático, sin señal aquí) y 3 del laboratorio (rechaza uno inválido y otro que suplanta a un experto fijo): ' + exp.length);
const lab = await herramienta('aprendizaje', { vista: 'laboratorio' });
check(lab.rows.length === 3 && lab.rows.every((r) => r.horasEnVivo > 0), 'los 3 del laboratorio aprenden en vivo: ' + lab.rows.map((r) => r.id + ' ' + r.horasEnVivo + ' h').join(', '));
check(lab.laboratorio.estrategiasProbadas === 2232 && lab.laboratorio.fueraDeMuestraTop5.sharpeAnual === 1, 'la vista laboratorio resume lo publicado');
check((porTipo.semana || 0) >= 7 && (porTipo.semana || 0) <= 9 && !porTipo.ntfy, 'avisos: el ranking semanal se mira una vez por hora (' + porTipo.semana + ' en 8 h) y con precios tranquilos no sale ningún aviso (ni resumen)');
check((porTipo.lab || 0) >= 1 && (porTipo.lab || 0) <= 3, 'consulta el laboratorio como mucho cada 6 horas: ' + porTipo.lab + ' veces en 8 h');
const al = (await herramienta('aprendizaje', { vista: 'alertas' })).rows;
check(al.some((a) => a.tipo === 'laboratorio' && a.texto.startsWith('Llegan del laboratorio')), 'avisa de las que llegan del laboratorio');
const E2 = estado();
check(E2.monedas.ETH.n - nEthAntes === E2.monedas.BTC.n - nBtcAntes && E2.monedas.ETH.t === E2.monedas.BTC.t, 'tras un hueco de 3 h sin precio, ETH cuenta las mismas horas que BTC: ' + (E2.monedas.ETH.n - nEthAntes) + ' y ' + (E2.monedas.BTC.n - nBtcAntes));
const posLab = E2.expertos['lab_cruce_24_168_c0.5_sec_amb_nf_h1'].pos;
const netoLab = Object.values(posLab).reduce((a, b) => a + b, 0), brutoLab = Object.values(posLab).reduce((a, b) => a + Math.abs(b), 0);
check(Object.keys(posLab).length >= 10 && Math.abs(netoLab) < 0.5 * brutoLab, 'la estrategia relativa entre monedas reparte compras y ventas: ' + Object.keys(posLab).length + ' monedas, neto ' + netoLab.toFixed(3) + ' de ' + brutoLab.toFixed(3));
const pos = (await herramienta('aprendizaje', { vista: 'posiciones' })).rows;
check(pos.length === 30 && pos.some((x) => x.moneda === 'ORO') && pos.some((x) => x.moneda === 'SP500'), '20 cripto, 9 de trade.xyz (oro, petróleo, índices, divisas…) y el cobro del funding en las posiciones: ' + pos.length);
const res1 = (await herramienta('aprendizaje', { vista: 'resumen' })).rows[0];
console.log('     resumen:', JSON.stringify(res1));
const est = db.prepare("SELECT length(json) AS b FROM ap_estado WHERE id = 'principal'").get();
console.log('     tamaño del estado:', est.b, 'bytes; peticiones por tipo:', JSON.stringify(porTipo));
cpuMin.sort((a, b) => a - b);
console.log('     tiempo por minuto en vivo: mediana ' + cpuMin[Math.floor(cpuMin.length / 2)].toFixed(1) + ' ms, p95 ' + cpuMin[Math.floor(cpuMin.length * 0.95)].toFixed(1) + ' ms');
const car = (await herramienta('aprendizaje', { vista: 'carteras' })).rows;
check(car.length === 30 && car[0].horas >= 7, '30 carteras seguidas con horas de historial: ' + car[0].horas);
